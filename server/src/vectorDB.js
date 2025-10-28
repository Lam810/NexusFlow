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

    // 创建聊天历史表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat_history (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        embedding BLOB,
        timestamp INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建动态数据表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS dynamics_data (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding BLOB,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建索引
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_documents_file ON documents(filename);
      CREATE INDEX IF NOT EXISTS idx_documents_created ON documents(created_at);
      CREATE INDEX IF NOT EXISTS idx_files_created ON files(created_at);
      CREATE INDEX IF NOT EXISTS idx_chat_history_workflow ON chat_history(workflow_id);
      CREATE INDEX IF NOT EXISTS idx_chat_history_timestamp ON chat_history(timestamp);
      CREATE INDEX IF NOT EXISTS idx_dynamics_data_created ON dynamics_data(created_at);
      CREATE INDEX IF NOT EXISTS idx_dynamics_data_title ON dynamics_data(title);
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

  // ==================== 动态数据管理方法 ====================
  
  // 添加动态数据
  addDynamicData(title, content, embedding, metadata = null) {
    const id = `dynamic_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const stmt = this.db.prepare(`
      INSERT INTO dynamics_data (id, title, content, embedding, metadata)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      id,
      title,
      content,
      embedding ? JSON.stringify(embedding) : null,
      metadata ? JSON.stringify(metadata) : null
    );
    
    return { id, title, content, metadata };
  }

  // 批量添加动态数据
  batchAddDynamicData(items, embeddingFunc) {
    const results = [];
    const errors = [];
    
    for (const item of items) {
      try {
        let embedding = null;
        if (embeddingFunc) {
          // 这里假设embeddingFunc已经准备好
          // 实际调用在API层完成
          embedding = item.embedding || null;
        }
        
        const result = this.addDynamicData(
          item.title,
          item.content,
          embedding,
          item.metadata
        );
        results.push(result);
      } catch (error) {
        errors.push({ item, error: error.message });
      }
    }
    
    return { success: results.length, failed: errors.length, results, errors };
  }

  // 搜索动态数据（基于embedding相似度）
  searchDynamicData(queryEmbedding, topK = 5, threshold = 0.3) {
    const stmt = this.db.prepare(`
      SELECT id, title, content, embedding, metadata, created_at
      FROM dynamics_data
      WHERE embedding IS NOT NULL
      ORDER BY created_at DESC
    `);
    
    const results = stmt.all();
    
    if (results.length === 0) {
      return [];
    }
    
    // 计算相似度
    const similarities = results.map(item => {
      const embedding = JSON.parse(item.embedding);
      const similarity = this.cosineSimilarity(queryEmbedding, embedding);
      return {
        id: item.id,
        title: item.title,
        content: item.content,
        metadata: item.metadata ? JSON.parse(item.metadata) : null,
        similarity: similarity,
        created_at: item.created_at
      };
    });
    
    // 过滤并排序
    return similarities
      .filter(item => item.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  // 获取所有动态数据
  getAllDynamicData(limit = 100) {
    const stmt = this.db.prepare(`
      SELECT id, title, content, metadata, created_at, updated_at
      FROM dynamics_data
      ORDER BY created_at DESC
      LIMIT ?
    `);
    
    const results = stmt.all(limit);
    return results.map(r => ({
      ...r,
      metadata: r.metadata ? JSON.parse(r.metadata) : null
    }));
  }

  // 根据ID获取动态数据
  getDynamicDataById(id) {
    const stmt = this.db.prepare(`
      SELECT id, title, content, embedding, metadata, created_at, updated_at
      FROM dynamics_data
      WHERE id = ?
    `);
    
    const result = stmt.get(id);
    if (result) {
      return {
        ...result,
        embedding: result.embedding ? JSON.parse(result.embedding) : null,
        metadata: result.metadata ? JSON.parse(result.metadata) : null
      };
    }
    return null;
  }

  // 更新动态数据
  updateDynamicData(id, title, content, embedding, metadata) {
    const stmt = this.db.prepare(`
      UPDATE dynamics_data
      SET title = ?, content = ?, embedding = ?, metadata = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    
    const result = stmt.run(
      title,
      content,
      embedding ? JSON.stringify(embedding) : null,
      metadata ? JSON.stringify(metadata) : null,
      id
    );
    
    return result.changes > 0;
  }

  // 删除动态数据
  deleteDynamicData(id) {
    const stmt = this.db.prepare('DELETE FROM dynamics_data WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  // 清空所有动态数据
  clearAllDynamicData() {
    const stmt = this.db.prepare('DELETE FROM dynamics_data');
    const result = stmt.run();
    return result.changes;
  }

  // 获取动态数据统计
  getDynamicDataStats() {
    const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM dynamics_data');
    const withEmbedding = this.db.prepare('SELECT COUNT(*) as count FROM dynamics_data WHERE embedding IS NOT NULL');
    
    return {
      total: countStmt.get().count,
      withEmbedding: withEmbedding.get().count
    };
  }

  // ==================== 聊天历史管理方法 ====================
  
  // 保存聊天历史记录
  saveChatHistory(workflowId, question, answer, questionEmbedding, timestamp) {
    const id = `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const stmt = this.db.prepare(`
      INSERT INTO chat_history (id, workflow_id, question, answer, embedding, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      id,
      workflowId,
      question,
      answer,
      questionEmbedding ? JSON.stringify(questionEmbedding) : null,
      timestamp || Date.now()
    );
    
    return { id, workflowId, question, answer, timestamp };
  }

  // 搜索相似的聊天历史
  searchChatHistory(queryEmbedding, workflowId, topK = 3) {
    const stmt = this.db.prepare(`
      SELECT id, question, answer, embedding, timestamp
      FROM chat_history
      WHERE workflow_id = ? AND embedding IS NOT NULL
      ORDER BY timestamp DESC
    `);
    
    const results = stmt.all(workflowId);
    
    if (results.length === 0) {
      return [];
    }
    
    // 计算与查询的相似度
    const similarities = results.map(chat => {
      const embedding = JSON.parse(chat.embedding);
      const similarity = this.cosineSimilarity(queryEmbedding, embedding);
      return {
        question: chat.question,
        answer: chat.answer,
        timestamp: chat.timestamp,
        similarity: similarity
      };
    });
    
    // 按相似度排序并返回topK个结果
    return similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  // 获取工作流的所有聊天历史
  getChatHistory(workflowId, limit = 50) {
    const stmt = this.db.prepare(`
      SELECT question, answer, timestamp
      FROM chat_history
      WHERE workflow_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    
    return stmt.all(workflowId, limit);
  }

  // 清除工作流的聊天历史
  clearChatHistory(workflowId) {
    const stmt = this.db.prepare('DELETE FROM chat_history WHERE workflow_id = ?');
    const result = stmt.run(workflowId);
    return result.changes;
  }

  // 获取聊天历史统计
  getChatHistoryStats(workflowId) {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM chat_history
      WHERE workflow_id = ?
    `);
    
    const result = stmt.get(workflowId);
    return {
      totalMessages: result.count
    };
  }

  // 关闭数据库连接
  close() {
    this.db.close();
  }
}

export default VectorDB;
