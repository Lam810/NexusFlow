class EnhancedVectorSearch {
  constructor(vectorDB) {
    this.vectorDB = vectorDB;
    this.searchHistory = new Map(); // 搜索历史缓存
    this.similarityThreshold = 0.7; // 相似度阈值
  }

  // 增强的相似性搜索
  async searchSimilar(queryEmbedding, userId, options = {}) {
    const {
      topK = 5,
      threshold = this.similarityThreshold,
      includeMetadata = true,
      rerank = true,
      expandQuery = false
    } = options;

    // 获取所有嵌入向量
    const documents = await this.vectorDB.getAllEmbeddings(userId);
    
    if (documents.length === 0) {
      return [];
    }

    // 计算相似度
    const similarities = documents.map(doc => {
      const similarity = this.vectorDB.cosineSimilarity(queryEmbedding, doc.embedding);
      return {
        id: doc.id,
        text: doc.text,
        similarity: similarity,
        metadata: this.extractMetadata(doc.id)
      };
    });

    // 过滤低相似度结果
    let filteredResults = similarities.filter(result => result.similarity >= threshold);

    // 重新排序（如果启用）
    if (rerank) {
      filteredResults = this.rerankResults(filteredResults, queryEmbedding);
    }

    // 扩展查询（如果启用）
    if (expandQuery && filteredResults.length < topK) {
      const expandedResults = await this.expandQuery(queryEmbedding, filteredResults, topK);
      filteredResults = [...filteredResults, ...expandedResults];
    }

    // 返回topK个结果
    return filteredResults
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  // 重新排序结果
  rerankResults(results, queryEmbedding) {
    return results.map(result => {
      // 基于文本长度的权重调整
      const lengthWeight = Math.min(result.text.length / 500, 1.0);
      
      // 基于关键词匹配的权重
      const keywordWeight = this.calculateKeywordWeight(result.text, queryEmbedding);
      
      // 综合评分
      const adjustedScore = result.similarity * 0.7 + lengthWeight * 0.2 + keywordWeight * 0.1;
      
      return {
        ...result,
        similarity: adjustedScore,
        originalSimilarity: result.similarity,
        lengthWeight,
        keywordWeight
      };
    });
  }

  // 计算关键词权重
  calculateKeywordWeight(text, queryEmbedding) {
    // 这里可以实现更复杂的关键词匹配逻辑
    // 目前使用简单的文本长度作为代理
    return Math.min(text.length / 1000, 1.0);
  }

  // 扩展查询
  async expandQuery(queryEmbedding, existingResults, targetCount) {
    if (existingResults.length >= targetCount) {
      return [];
    }

    // 基于现有结果生成相关查询
    const relatedQueries = this.generateRelatedQueries(existingResults);
    const expandedResults = [];

    for (const relatedQuery of relatedQueries) {
      try {
        // 这里需要调用嵌入API生成相关查询的向量
        // const relatedEmbedding = await createEmbedding(relatedQuery);
        // const relatedResults = await this.searchSimilar(relatedEmbedding, { topK: 2 });
        // expandedResults.push(...relatedResults);
      } catch (error) {
        console.error('扩展查询失败:', error);
      }
    }

    return expandedResults;
  }

  // 生成相关查询
  generateRelatedQueries(results) {
    const queries = [];
    
    // 基于结果文本生成相关查询
    results.forEach(result => {
      const words = result.text.split(/\s+/).slice(0, 5); // 取前5个词
      if (words.length > 0) {
        queries.push(words.join(' '));
      }
    });

    return queries.slice(0, 3); // 最多3个相关查询
  }

  // 提取元数据
  extractMetadata(docId) {
    // 从文档ID中提取信息
    const parts = docId.split('-');
    return {
      fileId: parts[0],
      chunkIndex: parts[2] ? parseInt(parts[2]) : 0,
      docId: docId
    };
  }

  // 混合搜索（结合关键词和向量搜索）
  async hybridSearch(query, queryEmbedding, userId, options = {}) {
    const {
      topK = 5,
      keywordWeight = 0.3,
      vectorWeight = 0.7
    } = options;

    // 向量搜索
    const vectorResults = await this.searchSimilar(queryEmbedding, userId, { topK: topK * 2 });
    
    // 关键词搜索
    const keywordResults = await this.keywordSearch(query, userId, topK * 2);
    
    // 合并和去重结果
    const combinedResults = this.combineSearchResults(vectorResults, keywordResults, {
      vectorWeight,
      keywordWeight
    });

    return combinedResults.slice(0, topK);
  }

  // 关键词搜索
  async keywordSearch(query, userId, topK) {
    const documents = await this.vectorDB.getAllDocuments(userId);
    const queryWords = query.toLowerCase().split(/\s+/).filter(Boolean);
    
    const scoredDocs = documents.map(doc => {
      const text = doc.chunk_text.toLowerCase();
      let score = 0;
      
      // 计算关键词匹配分数
      queryWords.forEach(word => {
        let matches = 0;
        let offset = 0;
        while ((offset = text.indexOf(word, offset)) !== -1) {
          matches += 1;
          offset += Math.max(word.length, 1);
        }
        score += matches;
      });
      
      // 计算文本长度权重
      const lengthWeight = Math.min(text.length / 1000, 1.0);
      score = score * lengthWeight;
      
      return {
        id: doc.id,
        text: doc.chunk_text,
        similarity: score / queryWords.length, // 归一化分数
        metadata: {
          fileId: doc.filename,
          chunkIndex: doc.chunk_index,
          fileType: doc.file_type
        }
      };
    });

    return scoredDocs
      .filter(doc => doc.similarity > 0)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  // 合并搜索结果
  combineSearchResults(vectorResults, keywordResults, weights) {
    const resultMap = new Map();
    
    // 添加向量搜索结果
    vectorResults.forEach(result => {
      resultMap.set(result.id, {
        ...result,
        vectorScore: result.similarity,
        keywordScore: 0,
        combinedScore: result.similarity * weights.vectorWeight
      });
    });
    
    // 添加关键词搜索结果
    keywordResults.forEach(result => {
      const existing = resultMap.get(result.id);
      if (existing) {
        existing.keywordScore = result.similarity;
        existing.combinedScore = existing.vectorScore * weights.vectorWeight + 
                                result.similarity * weights.keywordWeight;
      } else {
        resultMap.set(result.id, {
          ...result,
          vectorScore: 0,
          keywordScore: result.similarity,
          combinedScore: result.similarity * weights.keywordWeight
        });
      }
    });
    
    return Array.from(resultMap.values())
      .sort((a, b) => b.combinedScore - a.combinedScore);
  }

  // 智能纠错和建议
  async suggestCorrections(query, searchResults, userId) {
    const suggestions = [];
    
    if (searchResults.length === 0) {
      // 如果没有找到结果，建议相关搜索
      suggestions.push({
        type: 'no_results',
        message: '未找到相关结果',
        suggestions: await this.generateSearchSuggestions(query, userId)
      });
    } else if (searchResults[0].similarity < 0.5) {
      // 如果相似度较低，建议优化查询
      suggestions.push({
        type: 'low_similarity',
        message: '搜索结果相似度较低',
        suggestions: await this.generateQueryOptimizations(query)
      });
    }
    
    return suggestions;
  }

  // 生成搜索建议
  async generateSearchSuggestions(query, userId) {
    const documents = await this.vectorDB.getAllDocuments(userId);
    const suggestions = [];
    
    // 基于现有文档生成建议
    const commonTerms = this.extractCommonTerms(documents);
    const queryWords = query.toLowerCase().split(/\s+/);
    
    commonTerms.forEach(term => {
      if (!queryWords.includes(term.toLowerCase())) {
        suggestions.push(`${query} ${term}`);
      }
    });
    
    return suggestions.slice(0, 5);
  }

  // 生成查询优化建议
  async generateQueryOptimizations(query) {
    return [
      `尝试使用更具体的关键词: "${query}"`,
      `使用同义词或相关词汇`,
      `简化查询语句`,
      `检查拼写是否正确`
    ];
  }

  // 提取常见术语
  extractCommonTerms(documents) {
    const termCount = new Map();
    
    documents.forEach(doc => {
      const words = doc.chunk_text.toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(word => word.length > 2);
      
      words.forEach(word => {
        termCount.set(word, (termCount.get(word) || 0) + 1);
      });
    });
    
    return Array.from(termCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([term]) => term);
  }

  // 获取搜索统计
  getSearchStats(userId) {
    const history = this.searchHistory.get(userId) || new Map();
    return {
      totalSearches: history.size,
      averageResults: this.calculateAverageResults(history),
      topQueries: this.getTopQueries(history)
    };
  }

  // 计算平均结果数
  calculateAverageResults(history) {
    if (history.size === 0) return 0;
    
    let totalResults = 0;
    history.forEach(results => {
      totalResults += results.length;
    });
    
    return totalResults / history.size;
  }

  // 获取热门查询
  getTopQueries(history) {
    const queryCount = new Map();
    
    history.forEach((results, query) => {
      queryCount.set(query, (queryCount.get(query) || 0) + 1);
    });
    
    return Array.from(queryCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([query, count]) => ({ query, count }));
  }

  // 记录搜索历史
  recordSearch(userId, query, results) {
    if (!this.searchHistory.has(userId)) this.searchHistory.set(userId, new Map());
    const history = this.searchHistory.get(userId);
    history.set(query, results);
    
    // 限制历史记录大小
    if (history.size > 100) {
      const firstKey = history.keys().next().value;
      history.delete(firstKey);
    }
  }
}

export default EnhancedVectorSearch;
