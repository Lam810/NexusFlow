# 向量数据库与知识库管理增强功能

## 概述

本次更新大幅扩展了知识库的文件格式支持，并优化了向量处理策略，提供了更高级的匹配和纠错机制。

## 🆕 新功能

### 1. 扩展文件格式支持

现在支持以下文件格式：

- **文本文件**: `.txt`, `.md`
- **Microsoft Office**: `.docx`, `.doc`, `.xlsx`, `.xls`
- **PDF文档**: `.pdf`
- **数据文件**: `.csv`, `.json`
- **网页文件**: `.html`, `.htm`
- **XML文档**: `.xml`

### 2. 智能文件解析

- **自动格式检测**: 根据文件扩展名自动选择解析器
- **元数据提取**: 提取文件结构信息（如Excel工作表、PDF页数等）
- **错误处理**: 完善的错误处理和回退机制

### 3. 优化的文本分块策略

#### 结构化分块
- 优先按段落分割（`\n\n`）
- 长段落按句子分割
- 保持文档结构完整性

#### 滑动窗口分块
- 智能边界检测（单词、句子边界）
- 可配置重叠度
- 防止无限循环

#### 混合分块
- 结合结构化分块和滑动窗口
- 自动选择最佳策略
- 可配置参数

### 4. 增强的向量搜索

#### 多种搜索模式
- **向量搜索**: 基于语义相似度
- **关键词搜索**: 基于文本匹配
- **混合搜索**: 结合向量和关键词搜索

#### 智能重排序
- 基于文本长度的权重调整
- 关键词匹配权重
- 综合评分机制

#### 查询扩展
- 基于搜索结果生成相关查询
- 自动补充搜索结果
- 提高召回率

### 5. 智能纠错和建议

#### 搜索建议
- 无结果时的替代建议
- 低相似度时的优化建议
- 基于历史搜索的推荐

#### 查询优化
- 拼写检查建议
- 关键词优化
- 查询简化建议

## 🔧 API 端点

### 文件上传
```
POST /api/vector/upload
```
支持多种文件格式，自动解析和分块。

**参数**:
- `file`: 上传的文件
- `chunkOptions`: 分块配置
  - `chunkSize`: 块大小（默认800）
  - `overlap`: 重叠度（默认100）
  - `maxChunks`: 最大块数（默认50）
  - `preserveStructure`: 保持结构（默认true）

### 增强搜索
```
POST /api/vector/search
```
支持多种搜索模式和高级选项。

**参数**:
- `query`: 搜索查询
- `topK`: 返回结果数量（默认5）
- `searchType`: 搜索类型（'vector', 'keyword', 'hybrid'）
- `options`: 高级选项
  - `threshold`: 相似度阈值
  - `rerank`: 是否重排序
  - `expandQuery`: 是否扩展查询

### 文件格式信息
```
GET /api/vector/formats
```
获取支持的文件格式列表和详细信息。

### 搜索统计
```
GET /api/vector/search-history
```
获取搜索历史和统计信息。

### 文件解析测试
```
POST /api/vector/parse-test
```
测试文件解析功能，不存储到数据库。

## 📊 性能优化

### 内存管理
- 文件大小限制（2MB）
- 文本长度限制（100KB）
- 块数量限制（50个）
- 防止内存泄漏

### 处理效率
- 并行处理多个块
- 智能缓存机制
- 错误恢复机制

### 搜索性能
- 相似度阈值过滤
- 结果缓存
- 历史记录管理

## 🛠️ 技术实现

### 文件解析器 (`FileParser`)
- 模块化设计，易于扩展
- 统一的解析接口
- 完善的错误处理

### 增强搜索 (`EnhancedVectorSearch`)
- 多种搜索算法
- 智能重排序
- 查询扩展和纠错

### 数据库优化
- 保持原有SQLite结构
- 添加元数据支持
- 索引优化

## 🚀 使用示例

### 上传多种格式文件
```javascript
// 上传PDF文件
const formData = new FormData();
formData.append('file', pdfFile);
formData.append('chunkOptions', JSON.stringify({
  chunkSize: 1000,
  overlap: 150,
  preserveStructure: true
}));

const response = await fetch('/api/vector/upload', {
  method: 'POST',
  body: formData
});
```

### 混合搜索
```javascript
const searchResponse = await fetch('/api/vector/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: '人工智能应用',
    searchType: 'hybrid',
    topK: 10,
    options: {
      threshold: 0.5,
      rerank: true,
      expandQuery: true
    }
  })
});
```

## 🔍 故障排除

### 常见问题

1. **文件解析失败**
   - 检查文件格式是否支持
   - 确认文件大小不超过2MB
   - 查看错误日志获取详细信息

2. **搜索结果不准确**
   - 调整相似度阈值
   - 尝试不同的搜索类型
   - 使用查询优化建议

3. **内存使用过高**
   - 减少块大小
   - 限制最大块数
   - 检查文件大小限制

### 调试工具

- 使用 `/api/vector/parse-test` 测试文件解析
- 查看 `/api/vector/stats` 获取系统统计
- 检查 `/api/vector/search-history` 了解搜索模式

## 📈 未来规划

- 支持更多文件格式（PPT、RTF等）
- 实现文档版本管理
- 添加全文索引
- 支持多语言文档
- 实现增量更新

---

通过这些增强功能，向量数据库和知识库管理系统现在能够处理更多类型的文档，提供更准确的搜索结果，并具备智能纠错能力，大大提升了用户体验和系统实用性。
