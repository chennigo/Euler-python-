let current = null;

/** 注册当前引擎实现。 */
export function setEngine(impl) {
  current = impl;
}

/**
 * 引擎契约。所有实现必须满足此签名。
 * @param {{question: string, context?: {file: string, startLine: number, endLine: number}}} req
 * @param {{signal?: AbortSignal}} opts
 * @returns {AsyncIterable<{type:'text',text:string}|{type:'citation',file:string,startLine:number|null}|{type:'done'}|{type:'error',message:string}>}
 */
export function ask(req, opts) {
  if (!current) throw new Error('AI engine not registered');
  return current.ask(req, opts);
}
