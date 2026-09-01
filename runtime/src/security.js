import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;

function comparable(value) {
  const normalized = path.normalize(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isWithin(root, target) {
  const normalizedRoot = comparable(root);
  const normalizedTarget = comparable(target);
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`);
}

export function parseAllowedRoots(value, cwd = process.cwd()) {
  const source = String(value || '').trim();
  if (!source) return [];
  let items;
  if (source.startsWith('[')) {
    const parsed = JSON.parse(source);
    if (!Array.isArray(parsed)) throw new Error('NEXUSFLOW_ALLOWED_DIRS JSON 必须是字符串数组');
    items = parsed;
  } else {
    items = source.split(path.delimiter);
  }
  return [...new Set(items
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .map(item => path.resolve(cwd, item))
  )];
}

async function realAllowedRoots(allowedRoots) {
  const roots = [];
  for (const root of allowedRoots) {
    try {
      roots.push(await fs.realpath(root));
    } catch {
      throw new Error(`授权目录不存在或不可访问：${root}`);
    }
  }
  return roots;
}

export async function resolveReadableFile(requestedPath, allowedRoots) {
  if (!requestedPath || allowedRoots.length === 0) throw new Error('未配置可读取目录');
  const target = await fs.realpath(path.resolve(requestedPath));
  const roots = await realAllowedRoots(allowedRoots);
  if (!roots.some(root => isWithin(root, target))) throw new Error('文件路径不在授权目录内');
  const stat = await fs.stat(target);
  if (!stat.isFile()) throw new Error('目标不是文件');
  return { target, stat };
}

export async function readAllowedFile(requestedPath, allowedRoots, maxBytes = DEFAULT_MAX_FILE_BYTES) {
  const { target, stat } = await resolveReadableFile(requestedPath, allowedRoots);
  if (stat.size > maxBytes) throw new Error(`文件超过 ${Math.round(maxBytes / 1024)}KB 限制`);
  return { path: target, size: stat.size, content: await fs.readFile(target, 'utf8') };
}

export async function resolveWritableFile(requestedPath, allowedRoots) {
  if (!requestedPath || allowedRoots.length === 0) throw new Error('未配置可写入目录');
  const absoluteTarget = path.resolve(requestedPath);
  const parent = await fs.realpath(path.dirname(absoluteTarget));
  const roots = await realAllowedRoots(allowedRoots);
  if (!roots.some(root => isWithin(root, parent)) || roots.some(root => comparable(absoluteTarget) === comparable(root))) {
    throw new Error('文件路径不在授权目录内');
  }
  try {
    const existingTarget = await fs.realpath(absoluteTarget);
    if (!roots.some(root => isWithin(root, existingTarget))) throw new Error('文件路径不在授权目录内');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return absoluteTarget;
}

export async function writeAllowedFile(requestedPath, content, allowedRoots, maxBytes = DEFAULT_MAX_FILE_BYTES) {
  const target = await resolveWritableFile(requestedPath, allowedRoots);
  const body = String(content ?? '');
  if (Buffer.byteLength(body) > maxBytes) throw new Error(`写入内容超过 ${Math.round(maxBytes / 1024)}KB 限制`);
  await fs.writeFile(target, body, { encoding: 'utf8', flag: 'w' });
  return { path: target, size: Buffer.byteLength(body) };
}
