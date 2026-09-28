import path from 'node:path';
import process from 'node:process';

const DEFAULT_KB = 'C:\\Users\\dcy10\\Desktop\\dph\\Des-CTF-Knowledge-main\\Des-CTF-Knowledge-main';

/** 知识库根目录（绝对路径）。 */
export function kbRoot() {
  return path.resolve(process.env.KB_ROOT || DEFAULT_KB);
}

/**
 * 把知识库内的相对路径解析为绝对路径。
 * 任何逃出知识库根目录的路径都抛错——这是安全边界，不要放宽。
 */
export function resolveInKb(relPath) {
  const root = kbRoot();
  // 绝对路径直接拒绝：path.resolve 会让它绕过 root 前缀检查
  if (path.isAbsolute(relPath)) {
    throw new Error(`path escapes knowledge base: ${relPath}`);
  }
  const abs = path.resolve(root, relPath);
  const rel = path.relative(root, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`path escapes knowledge base: ${relPath}`);
  }
  return abs;
}
