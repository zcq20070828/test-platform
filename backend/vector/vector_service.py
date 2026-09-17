#!/usr/bin/env python3
"""
知识库向量服务 (BM25 实现)
用法: python3 vector_service.py
通过 stdin 接收 JSON 命令，输出 JSON 结果

命令:
  process  - 向量化文档 {docId, kbType, name, content}
  search   - 语义搜索   {query, kbType?, nResults?}
  delete   - 删除文档   {docId}
  list     - 列出文档   {kbType?}
  status   - 状态信息   {}
"""

import sys
import os
import json
import math
import re
import glob
import time
import threading
from collections import defaultdict

# ============ 配置 ============
VECTOR_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'vector_data')
os.makedirs(VECTOR_DIR, exist_ok=True)

CHUNK_SIZE = 600       # 段落分块大小
CHUNK_OVERLAP = 100     # 重叠字符数
MIN_CHUNK_LEN = 50      # 最小块长度

# BM25 参数
BM25_K1 = 1.5
BM25_B = 0.75

# 索引文件
INDEX_FILE = os.path.join(VECTOR_DIR, 'bm25_index.json')
DOCS_DIR = os.path.join(VECTOR_DIR, 'docs')
os.makedirs(DOCS_DIR, exist_ok=True)

_lock = threading.Lock()

# ============ 文本处理 ============
def tokenize(text):
    """中英文混合分词: 英文词 + 中文单字 + 中文2-gram"""
    if not text:
        return []
    text = text.lower()
    tokens = []
    # 英文词 (>=2字符)
    tokens.extend(re.findall(r'[a-z0-9]{2,}', text))
    # 中文段落中的单字和2-gram
    chinese_seqs = re.findall(r'[\u4e00-\u9fff]+', text)
    for seq in chinese_seqs:
        tokens.extend(list(seq))          # 单字
        for i in range(len(seq) - 1):    # 2-gram
            tokens.append(seq[i:i+2])
    return tokens

def get_chunks(content, doc_id):
    """将文档内容拆分为块"""
    if not content or len(content.strip()) < MIN_CHUNK_LEN:
        return []
    
    chunks = []
    # 尝试按段落拆分
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
            # 重叠：保留最后 OVERLAP 字符
            current = current[-CHUNK_OVERLAP:] + '\n' + para if current else para
    
    if len(current) >= MIN_CHUNK_LEN:
        chunks.append(current)
    
    return chunks

def compute_tfidf(terms, doc_term_freq, N, avgdl, doc_len):
    """计算文档的 TF-IDF 向量分数 (简化版 BM25)"""
    score = 0.0
    for term in set(terms):
        tf = terms.count(term)
        df = sum(1 for d in doc_term_freq.values() if term in d)
        if df == 0:
            continue
        idf = math.log((N - df + 0.5) / (df + 0.5) + 1)
        tf_norm = (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * doc_len / avgdl))
        score += idf * tf_norm
    return score

# ============ 持久化索引 ============
def load_index():
    """加载 BM25 索引"""
    if os.path.exists(INDEX_FILE):
        try:
            with open(INDEX_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError, UnicodeDecodeError):
            # 索引文件损坏(非 UTF-8 字节),返回空索引而非崩溃
            print('[WARN] 索引文件损坏,返回空索引', file=sys.stderr)
    return {'doc_term_freq': {}, 'doc_lengths': {}, 'doc_count': 0,
            'total_terms': defaultdict(int), 'total_terms_lock': defaultdict(int)}

def save_index(index):
    """保存 BM25 索引"""
    tmp = INDEX_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False)
    os.replace(tmp, INDEX_FILE)

def load_doc(doc_id):
    """加载单个文档"""
    safe_id = doc_id.replace('/', '_SLASH_').replace('\\', '_BSLASH_')
    path = os.path.join(DOCS_DIR, safe_id + '.json')
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return None

def save_doc(doc_id, data):
    """保存单个文档"""
    safe_id = doc_id.replace('/', '_SLASH_').replace('\\', '_BSLASH_')
    path = os.path.join(DOCS_DIR, safe_id + '.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)

def remove_doc(doc_id):
    """删除文档文件"""
    safe_id = doc_id.replace('/', '_SLASH_').replace('\\', '_BSLASH_')
    path = os.path.join(DOCS_DIR, safe_id + '.json')
    if os.path.exists(path):
        os.remove(path)

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
    
    # 获取现有索引
    index = load_index()
    
    # 如果文档已存在，先删除旧数据
    if doc_id in index['doc_term_freq']:
        old_doc = load_doc(doc_id)
        if old_doc:
            for old_chunk in old_doc.get('chunks', []):
                for term in old_chunk.get('terms', []):
                    index['total_terms'][term] -= 1
            del index['doc_term_freq'][doc_id]
    
    # 为每个 chunk 建索引
    chunk_data = []
    all_terms = set()
    for i, chunk_text in enumerate(chunks):
        terms = tokenize(chunk_text)
        terms_unique = list(dict.fromkeys(terms))  # 保持顺序的去重
        chunk_data.append({
            'chunkIndex': i,
            'text': chunk_text,
            'terms': terms_unique,
            'termCount': len(terms)
        })
        all_terms.update(terms_unique)
    
    # 更新全局 term 频率
    for term in all_terms:
        index['total_terms'][term] = index['total_terms'].get(term, 0) + 1
    
    # 更新索引
    index['doc_term_freq'][doc_id] = {term: 1 for term in all_terms}
    index['doc_lengths'][doc_id] = sum(len(c['terms']) for c in chunk_data)
    index['doc_count'] = len(index['doc_term_freq'])
    
    # 保存文档内容
    doc_data = {
        'docId': doc_id,
        'kbType': kb_type,
        'name': name,
        'chunks': chunk_data,
        'vectorizedAt': time.time()
    }
    save_doc(doc_id, doc_data)
    save_index(index)
    
    return {
        'success': True,
        'docId': doc_id,
        'chunks': len(chunks),
        'kbType': kb_type
    }

def cmd_process_all(input_data):
    """批量向量化知识库目录（由 server.js 调用）"""
    kb_type = input_data.get('kbType')
    kb_root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'knowledge_base')
    kb_root = os.path.join(kb_root, kb_type) if kb_type else kb_root
    
    if not os.path.exists(kb_root):
        return {'success': False, 'error': f'知识库目录不存在: {kb_root}'}
    
    results = []
    for root, _, files in os.walk(kb_root):
        for fname in files:
            fpath = os.path.join(root, fname)
            rel_path = os.path.relpath(fpath, kb_root)
            doc_id = f'{kb_type}/{rel_path}' if kb_type else rel_path
            try:
                with open(fpath, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read()
                result = cmd_process({
                    'docId': doc_id,
                    'kbType': kb_type,
                    'name': fname,
                    'content': content
                })
                results.append(result)
            except Exception as e:
                results.append({'docId': doc_id, 'success': False, 'error': str(e)})
    
    total_chunks = sum(r.get('chunks', 0) for r in results)
    return {'success': True, 'processed': len(results), 'totalChunks': total_chunks, 'results': results}

def cmd_search(input_data):
    """语义搜索"""
    query = input_data.get('query', '')
    kb_type = input_data.get('kbType')  # None = 全部
    n_results = input_data.get('nResults', 5)
    
    if not query or not query.strip():
        return {'success': True, 'results': [], 'query': query}
    
    query_terms = tokenize(query)
    if not query_terms:
        return {'success': True, 'results': [], 'query': query}
    
    index = load_index()
    N = max(index['doc_count'], 1)
    avgdl = (sum(index['doc_lengths'].values()) / N) if N > 0 else 1
    
    # 对每个文档计算 BM25 分数
    scores = {}
    for doc_id, doc_df in index['doc_term_freq'].items():
        # 过滤 kbType
        if kb_type and not doc_id.startswith(kb_type + '/'):
            continue
        
        doc_len = index['doc_lengths'].get(doc_id, 0)
        score = 0.0
        for term in query_terms:
            if term in doc_df:
                tf = doc_df.get(term, 0)
                df = sum(1 for d in index['doc_term_freq'].values() if term in d)
                if df > 0:
                    idf = math.log((N - df + 0.5) / (df + 0.5) + 1)
                    tf_norm = (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * doc_len / avgdl))
                    score += idf * tf_norm
        
        if score > 0:
            scores[doc_id] = score
    
    # 排序并取 top N
    sorted_docs = sorted(scores.items(), key=lambda x: -x[1])[:n_results]
    
    results = []
    for doc_id, score in sorted_docs:
        doc = load_doc(doc_id)
        if doc:
            # 找最相关的 chunk
            best_chunk = None
            best_chunk_score = 0
            for chunk in doc.get('chunks', []):
                chunk_score = sum(1 for t in query_terms if t in chunk.get('terms', []))
                if chunk_score > best_chunk_score:
                    best_chunk_score = chunk_score
                    best_chunk = chunk
            
            if best_chunk:
                results.append({
                    'docId': doc_id,
                    'name': doc.get('name', doc_id),
                    'kbType': doc.get('kbType', 'general'),
                    'content': best_chunk['text'],
                    'score': round(score, 4),
                    'chunkIndex': best_chunk.get('chunkIndex', 0),
                    'chunkCount': len(doc.get('chunks', []))
                })
    
    return {'success': True, 'results': results, 'query': query}

def cmd_delete(input_data):
    """删除文档"""
    doc_id = input_data.get('docId')
    if not doc_id:
        return {'success': False, 'error': '缺少 docId'}
    
    index = load_index()
    if doc_id not in index['doc_term_freq']:
        return {'success': True, 'docId': doc_id, 'message': '文档不在索引中'}
    
    # 恢复 term 频率
    doc = load_doc(doc_id)
    if doc:
        for chunk in doc.get('chunks', []):
            for term in chunk.get('terms', []):
                index['total_terms'][term] = max(0, index['total_terms'].get(term, 1) - 1)
    
    del index['doc_term_freq'][doc_id]
    if doc_id in index['doc_lengths']:
        del index['doc_lengths'][doc_id]
    index['doc_count'] = len(index['doc_term_freq'])
    
    save_index(index)
    remove_doc(doc_id)
    
    return {'success': True, 'docId': doc_id}

def cmd_list(input_data):
    """列出已向量化文档"""
    kb_type = input_data.get('kbType')
    
    index = load_index()
    docs = []
    for doc_id in index['doc_term_freq'].keys():
        if kb_type and not doc_id.startswith(kb_type + '/'):
            continue
        doc = load_doc(doc_id)
        if doc:
            docs.append({
                'docId': doc_id,
                'name': doc.get('name', doc_id),
                'kbType': doc.get('kbType', 'general'),
                'chunks': len(doc.get('chunks', [])),
                'vectorizedAt': doc.get('vectorizedAt')
            })
    
    return {'success': True, 'documents': docs, 'total': len(docs)}

def cmd_status():
    """向量库状态"""
    index = load_index()
    total_terms = len(index['total_terms'])
    return {
        'success': True,
        'status': 'ok',
        'totalDocs': index['doc_count'],
        'totalChunks': sum(len(load_doc(d).get('chunks', [])) for d in index['doc_term_freq'].keys() if load_doc(d)),
        'totalTerms': total_terms,
        'engine': 'BM25',
        'indexFile': INDEX_FILE,
        'docsDir': DOCS_DIR
    }

# ============ 主循环 ============
def main():
    """从 sys.argv[1] 读取命令，从 stdin 读取参数，写入 stdout"""
    # 命令来自 sys.argv[1]，参数来自 stdin 的 JSON
    cmd_from_arg = sys.argv[1] if len(sys.argv) > 1 else None

    # 读取 stdin 的完整 JSON
    try:
        stdin_data = sys.stdin.read().strip() if not sys.stdin.isatty() else '{}'
        data = json.loads(stdin_data) if stdin_data else {}
    except json.JSONDecodeError:
        data = {}

    # 命令优先用 argv[1]，其次用 stdin JSON
    command = cmd_from_arg or data.pop('command', None)

    if not command:
        print(json.dumps({'error': '缺少 command 字段'}, ensure_ascii=False), flush=True)
        return

    try:
        result = None
        if command == 'process':
            if data.get('all'):
                result = cmd_process_all(data)
            else:
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

