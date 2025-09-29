import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

class VectorDB {
  constructor(dbPath = 'vector_knowledge.db') {
    this.dbPath = dbPath;
    this.db = new Database(dbPath);
    this.init();
  }

  init() {
    // 创建用户表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建工作流表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflows (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        nodes TEXT NOT NULL,
        edges TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )
    `);

    // 创建文档表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        filename TEXT,
        original_text TEXT,
        chunk_index INTEGER,
        chunk_text TEXT,
        embedding BLOB,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        file_size INTEGER,
        file_type TEXT,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )
    `);

    // 创建文件信息表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        filename TEXT,
        original_text TEXT,
        file_size INTEGER,
        file_type TEXT,
        chunk_count INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )
    `);

    // 创建索引
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_documents_file ON documents(filename);
      CREATE INDEX IF NOT EXISTS idx_documents_created ON documents(created_at);
      CREATE INDEX IF NOT EXISTS idx_files_created ON files(created_at);
    `);
  }

  // 插入文档块
  insertDocument(doc) {
    const stmt = this.db.prepare(`
      INSERT INTO documents (id, filename, original_text, chunk_index, chunk_text, embedding, file_size, file_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      doc.id,
      doc.filename || 'unknown',
      doc.original_text || '',
      doc.chunk_index || 0,
      doc.chunk_text,
      JSON.stringify(doc.embedding),
      doc.file_size || 0,
      doc.file_type || 'txt'
    );
  }

  // 插入文件信息
  insertFile(fileInfo) {
    const stmt = this.db.prepare(`
      INSERT INTO files (id, filename, original_text, file_size, file_type, chunk_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      fileInfo.id,
      fileInfo.filename,
      fileInfo.original_text,
      fileInfo.file_size,
      fileInfo.file_type,
      fileInfo.chunk_count
    );
  }

  // 获取所有文档
  getAllDocuments() {
    const stmt = this.db.prepare(`
      SELECT id, filename, chunk_index, chunk_text, file_size, file_type, created_at
      FROM documents 
      ORDER BY created_at DESC
    `);
    return stmt.all();
  }

  // 获取所有文件
  getAllFiles() {
    const stmt = this.db.prepare(`
      SELECT id, filename, file_size, file_type, chunk_count, created_at
      FROM files 
      ORDER BY created_at DESC
    `);
    return stmt.all();
  }

  // 根据文件名获取文档
  getDocumentsByFilename(filename) {
    const stmt = this.db.prepare(`
      SELECT id, filename, chunk_index, chunk_text, file_size, file_type, created_at
      FROM documents 
      WHERE filename = ?
      ORDER BY chunk_index
    `);
    return stmt.all(filename);
  }

  // 获取文档的嵌入向量
  getDocumentEmbedding(id) {
    const stmt = this.db.prepare(`
      SELECT embedding FROM documents WHERE id = ?
    `);
    const result = stmt.get(id);
    return result ? JSON.parse(result.embedding) : null;
  }

  // 获取所有嵌入向量用于相似性搜索
  getAllEmbeddings() {
    const stmt = this.db.prepare(`
      SELECT id, chunk_text, embedding FROM documents
    `);
    const results = stmt.all();
    return results.map(r => ({
      id: r.id,
      text: r.chunk_text,
      embedding: JSON.parse(r.embedding)
    }));
  }

  // 删除文件及其所有文档块
  deleteFile(filename) {
    const deleteDocs = this.db.prepare(`DELETE FROM documents WHERE filename = ?`);
    const deleteFile = this.db.prepare(`DELETE FROM files WHERE filename = ?`);
    
    const docsDeleted = deleteDocs.run(filename).changes;
    const fileDeleted = deleteFile.run(filename).changes;
    
    return { docsDeleted, fileDeleted };
  }

  // 获取数据库统计信息
  getStats() {
    const totalDocs = this.db.prepare(`SELECT COUNT(*) as count FROM documents`).get().count;
    const totalFiles = this.db.prepare(`SELECT COUNT(*) as count FROM files`).get().count;
    const totalSize = this.db.prepare(`SELECT SUM(file_size) as size FROM files`).get().size || 0;
    
    return {
      totalDocuments: totalDocs,
      totalFiles: totalFiles,
      totalSize: totalSize
    };
  }

  // 搜索相似文档
  searchSimilar(queryEmbedding, topK = 5) {
    const documents = this.getAllEmbeddings();
    
    // 计算余弦相似度
    const similarities = documents.map(doc => {
      const similarity = this.cosineSimilarity(queryEmbedding, doc.embedding);
      return {
        id: doc.id,
        text: doc.text,
        similarity: similarity
      };
    });

    // 按相似度排序并返回topK个结果
    return similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  // 余弦相似度计算
  cosineSimilarity(a, b) {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length && i < b.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
  }

  // 用户管理方法
  async createUser(username, email, passwordHash) {
    const id = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const stmt = this.db.prepare(`
      INSERT INTO users (id, username, email, password_hash)
      VALUES (?, ?, ?, ?)
    `);
    
    try {
      stmt.run(id, username, email, passwordHash);
      return { id, username, email };
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new Error('用户名或邮箱已存在');
      }
      throw error;
    }
  }

  async getUserByUsername(username) {
    const stmt = this.db.prepare('SELECT * FROM users WHERE username = ?');
    return stmt.get(username);
  }

  async getUserByEmail(email) {
    const stmt = this.db.prepare('SELECT * FROM users WHERE email = ?');
    return stmt.get(email);
  }

  async getUserById(id) {
    const stmt = this.db.prepare('SELECT * FROM users WHERE id = ?');
    return stmt.get(id);
  }

  // 工作流管理方法
  async saveWorkflow(userId, workflowId, name, nodes, edges) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO workflows (id, user_id, name, nodes, edges, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    stmt.run(workflowId, userId, name, JSON.stringify(nodes), JSON.stringify(edges));
    return { id: workflowId, name, nodes, edges };
  }

  async getWorkflows(userId) {
    const stmt = this.db.prepare(`
      SELECT id, name, nodes, edges, created_at, updated_at 
      FROM workflows 
      WHERE user_id = ? 
      ORDER BY updated_at DESC
    `);
    
    const workflows = stmt.all(userId);
    return workflows.map(w => ({
      ...w,
      nodes: JSON.parse(w.nodes),
      edges: JSON.parse(w.edges)
    }));
  }

  async getWorkflow(userId, workflowId) {
    const stmt = this.db.prepare(`
      SELECT id, name, nodes, edges, created_at, updated_at 
      FROM workflows 
      WHERE id = ? AND user_id = ?
    `);
    
    const workflow = stmt.get(workflowId, userId);
    if (workflow) {
      return {
        ...workflow,
        nodes: JSON.parse(workflow.nodes),
        edges: JSON.parse(workflow.edges)
      };
    }
    return null;
  }

  async deleteWorkflow(userId, workflowId) {
    const stmt = this.db.prepare('DELETE FROM workflows WHERE id = ? AND user_id = ?');
    const result = stmt.run(workflowId, userId);
    return result.changes > 0;
  }

  // 关闭数据库连接
  close() {
    this.db.close();
  }
}

export default VectorDB;
