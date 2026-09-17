#!/usr/bin/env python3
"""
将现有文件索引迁移到 MySQL
用法: python3 migrate_to_mysql.py
"""

import sys
import os
import json
import mysql.connector
from pathlib import Path

# 数据库配置
DB_CONFIG = {
    'host': 'localhost',
    'user': 'appuser',
    'password': 'apppwd123',
    'database': 'test_platform',
    'charset': 'utf8mb4'
}

VECTOR_DIR = Path(__file__).parent / 'vector_data'
INDEX_FILE = VECTOR_DIR / 'bm25_index.json'
DOCS_DIR = VECTOR_DIR / 'docs'

def migrate():
    """执行迁移"""
    print("开始迁移知识库索引到 MySQL...")
    
    # 1. 加载现有索引
    if not INDEX_FILE.exists():
        print("❌ 索引文件不存在，无需迁移")
        return
    
    with open(INDEX_FILE, 'r', encoding='utf-8') as f:
        index = json.load(f)
    
    print(f"加载索引: {index['doc_count']} 个文档")
    
    # 2. 连接数据库
    conn = mysql.connector.connect(**DB_CONFIG)
    cursor = conn.cursor()
    
    try:
        # 3. 清空现有数据（如果需要重新迁移）
        cursor.execute("TRUNCATE TABLE kb_chunk_terms")
        cursor.execute("TRUNCATE TABLE kb_chunks")
        cursor.execute("TRUNCATE TABLE kb_doc_stats")
        cursor.execute("TRUNCATE TABLE kb_documents")
        cursor.execute("TRUNCATE TABLE kb_global_terms")
        print("清空现有表数据")
        
        # 4. 迁移全局词项频率
        print("迁移全局词项频率...")
        total_terms = index.get('total_terms', {})
        batch = []
        skipped = 0
        for term, freq in total_terms.items():
            if term and freq > 0:
                # 过滤异常长的词项（可能是 Base64 或编码错误）
                if len(term) <= 100:
                    batch.append((term, freq))
                else:
                    skipped += 1
        if skipped > 0:
            print(f"  跳过 {skipped} 个异常长词项（>100字符）")
        
        if batch:
            cursor.executemany(
                "INSERT INTO kb_global_terms (term, doc_freq) VALUES (%s, %s)",
                batch
            )
            print(f"  插入 {len(batch)} 个全局词项")
        
        # 5. 迁移文档数据
        print("迁移文档数据...")
        doc_ids = list(index['doc_term_freq'].keys())
        
        for doc_id in doc_ids:
            # 加载文档内容
            doc = load_doc(doc_id)
            if not doc:
                print(f"  ⚠️ 跳过 {doc_id}（文件不存在）")
                continue
            
            # 插入文档元数据
            cursor.execute("""
                INSERT INTO kb_documents (doc_id, kb_type, name, chunks_count, vectorized_at)
                VALUES (%s, %s, %s, %s, FROM_UNIXTIME(%s))
            """, (
                doc_id,
                doc.get('kbType', 'general'),
                doc.get('name', doc_id),
                len(doc.get('chunks', [])),
                doc.get('vectorizedAt', 0)
            ))
            
            # 插入文档统计
            doc_length = index['doc_lengths'].get(doc_id, 0)
            term_count = len(index['doc_term_freq'].get(doc_id, {}))
            cursor.execute("""
                INSERT INTO kb_doc_stats (doc_id, doc_length, term_count)
                VALUES (%s, %s, %s)
            """, (doc_id, doc_length, term_count))
            
            # 插入知识块
            chunks = doc.get('chunks', [])
            for chunk in chunks:
                chunk_index = chunk.get('chunkIndex', 0)
                text = chunk.get('text', '')
                term_count = chunk.get('termCount', 0)
                
                cursor.execute("""
                    INSERT INTO kb_chunks (doc_id, chunk_index, text, term_count)
                    VALUES (%s, %s, %s, %s)
                """, (doc_id, chunk_index, text, term_count))
                
                chunk_id = cursor.lastrowid
                
                # 插入词项（批量）
                terms = chunk.get('terms', [])
                if terms:
                    cursor.executemany(
                        "INSERT INTO kb_chunk_terms (chunk_id, term) VALUES (%s, %s)",
                        [(chunk_id, term) for term in terms if term]
                    )
            
            print(f"  ✓ {doc_id}: {len(chunks)} 块")
        
        conn.commit()
        print(f"\n✅ 迁移完成: {len(doc_ids)} 个文档")
        
        # 6. 验证
        cursor.execute("SELECT COUNT(*) FROM kb_documents")
        doc_count = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM kb_chunks")
        chunk_count = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM kb_global_terms")
        term_count = cursor.fetchone()[0]
        
        print(f"\n验证:")
        print(f"  文档数: {doc_count}")
        print(f"  知识块数: {chunk_count}")
        print(f"  词项数: {term_count}")
        
    finally:
        cursor.close()
        conn.close()

def load_doc(doc_id):
    """加载文档文件"""
    safe_id = doc_id.replace('/', '_SLASH_').replace('\\', '_BSLASH_')
    path = DOCS_DIR / f"{safe_id}.json"
    if path.exists():
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return None

if __name__ == '__main__':
    migrate()
