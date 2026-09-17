#!/usr/bin/env python3
"""
知识库向量服务 - MySQL 版本
用法: python3 vector_service_mysql.py <command> < input.json
命令: process, search, delete, list, status
"""

import sys
import os
import json
import math
import re
import time
import mysql.connector
from collections import defaultdict

# ============ 配置 ============
DB_CONFIG = {
    'host': 'localhost',
    'user': 'appuser',
    'password': 'apppwd123',
    'database': 'test_platform',
    'charset': 'utf8mb4'
}

CHUNK_SIZE = 600
CHUNK_OVERLAP = 100
MIN_CHUNK_LEN = 50

# BM25 参数
BM25_K1 = 1.5
BM25_B = 0.75

def get_db():
    """获取数据库连接"""
    return mysql.connector.connect(**DB_CONFIG)

# ============ 文本处理 ============
def tokenize(text):
    """中英文混合分词"""
    if not text:
        return []
    text = text.lower()
    tokens = []
    tokens.extend(re.findall(r'[a-z0-9]{2,}', text))
    chinese_seqs = re.findall(r'[\u4e00-\u9fff]+', text)
    for seq in chinese_seqs:
        tokens.extend(list(seq))
        for i in range(len(seq) - 1):
            tokens.append(seq[i:i+2])
    return tokens

def get_chunks(content, doc_id):
    """将文档内容拆分为块"""
    if not content or len(content.strip()) < MIN_CHUNK_LEN:
        return []
    
    chunks = []
    paragraphs = re.split(r'\n+', content)
    current = ''
    
    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        if len(current) + len(para) + 1 <= CHUNK_SIZE:
            current = (current + '\n' + para).strip()
        else:
            if len(current) >= MIN_CHUNK_LEN:
                chunks.append(current)
            current = current[-CHUNK_OVERLAP:] + '\n' + para if current else para
    
    if len(current) >= MIN_CHUNK_LEN:
        chunks.append(current)
    
    return chunks

# ============ 命令处理 ============

def cmd_process(input_data):
    """向量化单个文档"""
    doc_id = input_data.get('docId')
    kb_type = input_data.get('kbType', 'general')
    name = input_data.get('name', doc_id)
    content = input_data.get('content', '')
    
    if not doc_id:
        return {'success': False, 'error': '缺少 docId'}
    
    chunks = get_chunks(content, doc_id)
    if not chunks:
        return {'success': True, 'docId': doc_id, 'chunks': 0, 'message': '内容过短，无需分块'}
    
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # 删除旧数据
        cursor.execute("DELETE FROM kb_chunk_terms WHERE chunk_id IN (SELECT id FROM kb_chunks WHERE doc_id = %s)", (doc_id,))
        cursor.execute("DELETE FROM kb_chunks WHERE doc_id = %s", (doc_id,))
        cursor.execute("DELETE FROM kb_documents WHERE doc_id = %s", (doc_id,))
        cursor.execute("DELETE FROM kb_doc_stats WHERE doc_id = %s", (doc_id,))
        
        # 插入文档元数据
        cursor.execute("""
            INSERT INTO kb_documents (doc_id, kb_type, name, chunks_count, vectorized_at)
            VALUES (%s, %s, %s, %s, NOW())
        """, (doc_id, kb_type, name, len(chunks)))
        
        # 插入知识块和词项
        all_terms = set()
        total_term_count = 0
        
        for i, chunk_text in enumerate(chunks):
            terms = tokenize(chunk_text)
            terms_unique = list(dict.fromkeys(terms))
            
            # 插入知识块
            cursor.execute("""
                INSERT INTO kb_chunks (doc_id, chunk_index, text, term_count)
                VALUES (%s, %s, %s, %s)
            """, (doc_id, i, chunk_text, len(terms)))
            
            chunk_id = cursor.lastrowid
            
            # 插入词项（批量）
            if terms_unique:
                cursor.executemany(
                    "INSERT INTO kb_chunk_terms (chunk_id, term) VALUES (%s, %s)",
                    [(chunk_id, term) for term in terms_unique if term and len(term) <= 100]
                )
            
            all_terms.update(terms_unique)
            total_term_count += len(terms)
        
        # 插入文档统计
        cursor.execute("""
            INSERT INTO kb_doc_stats (doc_id, doc_length, term_count)
            VALUES (%s, %s, %s)
        """, (doc_id, total_term_count, len(all_terms)))
        
        # 更新全局词项频率
        for term in all_terms:
            if term and len(term) <= 100:
                cursor.execute("""
                    INSERT INTO kb_global_terms (term, doc_freq) VALUES (%s, 1)
                    ON DUPLICATE KEY UPDATE doc_freq = doc_freq + 1
                """, (term,))
        
        conn.commit()
        
        return {
            'success': True,
            'docId': doc_id,
            'chunks': len(chunks),
            'kbType': kb_type
        }
        
    except Exception as e:
        conn.rollback()
        return {'success': False, 'error': str(e)}
    finally:
        cursor.close()
        conn.close()

def cmd_search(input_data):
    """语义搜索"""
    query = input_data.get('query', '')
    kb_type = input_data.get('kbType')
    n_results = input_data.get('nResults', 5)
    
    if not query or not query.strip():
        return {'success': True, 'results': [], 'query': query}
    
    query_terms = tokenize(query)
    if not query_terms:
        return {'success': True, 'results': [], 'query': query}
    
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    
    try:
        # 获取文档统计
        cursor.execute("SELECT COUNT(*) as cnt FROM kb_documents")
        N = cursor.fetchone()['cnt'] or 1
        
        cursor.execute("SELECT SUM(doc_length) as total FROM kb_doc_stats")
        result = cursor.fetchone()
        total_len = float(result['total'] or 0) if result else 0
        avgdl = total_len / N if N > 0 else 1
        
        # 获取包含查询词项的文档
        placeholders = ','.join(['%s'] * len(query_terms))
        cursor.execute(f"""
            SELECT DISTINCT d.doc_id, d.name, d.kb_type, s.doc_length
            FROM kb_documents d
            JOIN kb_doc_stats s ON d.doc_id = s.doc_id
            JOIN kb_chunks c ON c.doc_id = d.doc_id
            JOIN kb_chunk_terms ct ON ct.chunk_id = c.id
            WHERE ct.term IN ({placeholders})
        """, query_terms)
        
        candidate_docs = cursor.fetchall()
        
        if not candidate_docs:
            return {'success': True, 'results': [], 'query': query}
        
        # 计算每个文档的 BM25 分数
        scores = {}
        for doc in candidate_docs:
            if kb_type and doc['kb_type'] != kb_type:
                continue
            
            doc_id = doc['doc_id']
            doc_len = float(doc['doc_length']) if doc['doc_length'] else 0
            score = 0.0
            
            for term in query_terms:
                # 获取词项文档频率
                cursor.execute("SELECT doc_freq FROM kb_global_terms WHERE term = %s", (term,))
                row = cursor.fetchone()
                df = row['doc_freq'] if row else 0
                
                if df > 0:
                    # 获取文档中词项频率（简化：假设为1）
                    idf = math.log((N - df + 0.5) / (df + 0.5) + 1)
                    tf_norm = (1 * (BM25_K1 + 1)) / (1 + BM25_K1 * (1 - BM25_B + BM25_B * doc_len / avgdl))
                    score += idf * tf_norm
            
            if score > 0:
                scores[doc_id] = score
        
        # 排序并取 top N
        sorted_docs = sorted(scores.items(), key=lambda x: -x[1])[:n_results]
        
        results = []
        for doc_id, score in sorted_docs:
            # 找最相关的知识块
            cursor.execute(f"""
                SELECT c.id, c.text, c.chunk_index, c.term_count
                FROM kb_chunks c
                JOIN kb_chunk_terms ct ON ct.chunk_id = c.id
                WHERE c.doc_id = %s AND ct.term IN ({placeholders})
                GROUP BY c.id
                ORDER BY COUNT(*) DESC
                LIMIT 1
            """, [doc_id] + query_terms)
            
            best_chunk = cursor.fetchone()
            if best_chunk:
                # 获取文档信息
                cursor.execute("SELECT name, kb_type FROM kb_documents WHERE doc_id = %s", (doc_id,))
                doc_info = cursor.fetchone()
                
                # 获取知识块总数
                cursor.execute("SELECT COUNT(*) as cnt FROM kb_chunks WHERE doc_id = %s", (doc_id,))
                chunk_count = cursor.fetchone()['cnt']
                
                results.append({
                    'docId': doc_id,
                    'name': doc_info['name'] if doc_info else doc_id,
                    'kbType': doc_info['kb_type'] if doc_info else 'general',
                    'content': best_chunk['text'],
                    'score': round(score, 4),
                    'chunkIndex': best_chunk['chunk_index'],
                    'chunkCount': chunk_count
                })
        
        return {'success': True, 'results': results, 'query': query}
        
    finally:
        cursor.close()
        conn.close()

def cmd_delete(input_data):
    """删除文档"""
    doc_id = input_data.get('docId')
    if not doc_id:
        return {'success': False, 'error': '缺少 docId'}
    
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # 检查文档是否存在
        cursor.execute("SELECT id FROM kb_documents WHERE doc_id = %s", (doc_id,))
        if not cursor.fetchone():
            return {'success': True, 'docId': doc_id, 'message': '文档不在索引中'}
        
        # 删除词项
        cursor.execute("DELETE FROM kb_chunk_terms WHERE chunk_id IN (SELECT id FROM kb_chunks WHERE doc_id = %s)", (doc_id,))
        # 删除知识块
        cursor.execute("DELETE FROM kb_chunks WHERE doc_id = %s", (doc_id,))
        # 删除文档元数据
        cursor.execute("DELETE FROM kb_documents WHERE doc_id = %s", (doc_id,))
        # 删除文档统计
        cursor.execute("DELETE FROM kb_doc_stats WHERE doc_id = %s", (doc_id,))
        
        conn.commit()
        
        return {'success': True, 'docId': doc_id}
        
    except Exception as e:
        conn.rollback()
        return {'success': False, 'error': str(e)}
    finally:
        cursor.close()
        conn.close()

def cmd_list(input_data):
    """列出已向量化文档"""
    kb_type = input_data.get('kbType')
    
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    
    try:
        if kb_type:
            cursor.execute("""
                SELECT doc_id, name, kb_type, chunks_count, vectorized_at
                FROM kb_documents
                WHERE kb_type = %s
                ORDER BY vectorized_at DESC
            """, (kb_type,))
        else:
            cursor.execute("""
                SELECT doc_id, name, kb_type, chunks_count, vectorized_at
                FROM kb_documents
                ORDER BY kb_type, vectorized_at DESC
            """)
        
        docs = cursor.fetchall()
        
        documents = []
        for doc in docs:
            documents.append({
                'docId': doc['doc_id'],
                'name': doc['name'],
                'kbType': doc['kb_type'],
                'chunks': doc['chunks_count'],
                'vectorized': bool(doc['vectorized_at']),   # 前端 KnowledgeView 读此字段显示「已解析」标签
                'vectorizedAt': doc['vectorized_at'].timestamp() if doc['vectorized_at'] else None
            })
        
        return {'success': True, 'documents': documents, 'total': len(documents)}
        
    finally:
        cursor.close()
        conn.close()

def cmd_status():
    """向量库状态"""
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    
    try:
        cursor.execute("SELECT COUNT(*) as cnt FROM kb_documents")
        doc_count = cursor.fetchone()['cnt']
        
        cursor.execute("SELECT COUNT(*) as cnt FROM kb_chunks")
        chunk_count = cursor.fetchone()['cnt']
        
        cursor.execute("SELECT COUNT(*) as cnt FROM kb_global_terms")
        term_count = cursor.fetchone()['cnt']
        
        return {
            'success': True,
            'status': 'ok',
            'totalDocs': doc_count,
            'totalChunks': chunk_count,
            'totalTerms': term_count,
            'engine': 'BM25-MySQL'
        }
        
    finally:
        cursor.close()
        conn.close()

# ============ 主循环 ============
def main():
    cmd_from_arg = sys.argv[1] if len(sys.argv) > 1 else None
    
    try:
        stdin_data = sys.stdin.read().strip() if not sys.stdin.isatty() else '{}'
        data = json.loads(stdin_data) if stdin_data else {}
    except json.JSONDecodeError:
        data = {}
    
    command = cmd_from_arg or data.pop('command', None)
    
    if not command:
        print(json.dumps({'error': '缺少 command 字段'}, ensure_ascii=False), flush=True)
        return
    
    try:
        result = None
        if command == 'process':
            result = cmd_process(data)
        elif command == 'search':
            result = cmd_search(data)
        elif command == 'delete':
            result = cmd_delete(data)
        elif command == 'list':
            result = cmd_list(data)
        elif command == 'status':
            result = cmd_status()
        else:
            result = {'error': f'未知命令: {command}'}
        
        if result is not None:
            print(json.dumps(result, ensure_ascii=False), flush=True)
        else:
            print(json.dumps({'error': '命令处理失败'}, ensure_ascii=False), flush=True)
    
    except Exception as e:
        import traceback
        print(json.dumps({'error': f'处理异常: {e}', 'trace': traceback.format_exc()}, ensure_ascii=False), flush=True)

if __name__ == '__main__':
    main()
