import type OpenAI from 'openai';
import { Stream } from 'openai/core/streaming';
import { chatSignal, checkCancelled } from './chat-cancellation.ts';
export class ModelStreamError extends Error {}

export function validateToolBindings(calls: any[], tools: any[]) {
  const verify = (value: any, schema: any): boolean => {
    if (!schema) return true;
    if (schema.enum && !schema.enum.includes(value)) return false;
    if (schema.type === 'string') return typeof value === 'string';
    if (schema.type === 'number') return typeof value === 'number' && Number.isFinite(value);
    if (schema.type === 'array') return Array.isArray(value) && value.every(item => verify(item, schema.items));
    if (schema.type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
      && (schema.required || []).every((key: string) => Object.hasOwn(value, key))
      && Object.entries(value).every(([key, item]) => schema.properties?.[key] ? verify(item, schema.properties[key]) : schema.additionalProperties !== false);
    return true;
  };
  for (const call of calls) {
    const tool = tools.find(item => item.function?.name === call.function?.name);
    if (!tool || !verify(JSON.parse(call.function.arguments), tool.function.parameters)) throw new ModelStreamError('模型请求了未启用的工具，或工具参数缺失/类型错误；本轮工具未执行。');
  }
}
type Options = { onText?: (text: string) => void; onReset?: () => void; onBuffered?: () => void };
export async function collectCompletion(client: OpenAI, params: any, options: Options = {}) {
  checkCancelled();
  const signal = chatSignal();
  const response = await client.chat.completions.create({ ...params, stream: true }, { signal, maxRetries: 0 }).asResponse();
  const validate = (content: string, calls: any[], finish: unknown) => {
    if (!['stop', 'length', 'tool_calls'].includes(String(finish))) throw new ModelStreamError('模型响应未完整正常结束；本轮未执行不完整工具。');
    if (!Array.isArray(calls) || content.length > 500_000) throw new ModelStreamError('模型响应结构或大小不合法。');
    if (calls.length > 4) throw new ModelStreamError('模型返回的工具调用超过本轮限制。');
    const ids = new Set();
    for (const call of calls) {
      if (typeof call.function?.arguments !== 'string' || call.function.arguments.length > 128_000) throw new ModelStreamError('工具参数缺失或超出安全范围。');
      if (!call.id || ids.has(call.id) || !call.function?.name || call.type !== 'function') throw new ModelStreamError('工具调用缺少名称、唯一 ID 或类型。');
      ids.add(call.id);
      let args; try { args = JSON.parse(call.function.arguments); } catch { throw new ModelStreamError('工具参数 JSON 不完整，未执行工具。'); }
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new ModelStreamError('工具参数必须是 JSON 对象。');
    }
    if (finish === 'tool_calls' && !calls.length) throw new ModelStreamError('模型结束标记与工具调用不一致。');
    if (calls.length && finish !== 'tool_calls' && finish !== 'stop') throw new ModelStreamError('工具参数在输出上限处截断，未执行工具。');
    return { choices: [{ message: { role: 'assistant', content, ...(calls.length ? { tool_calls: calls } : {}) }, finish_reason: finish }] };
  };
  if (/application\/(?:[\w.+-]+\+)?json/i.test(response.headers.get('content-type') || '')) {
    // Some compatible providers ignore stream:true. Consume this response, never replay it.
    options.onBuffered?.();
    let body: any;
    try { body = await response.json(); } catch { checkCancelled(); throw new ModelStreamError('模型返回损坏的 JSON，未重试或执行工具。'); }
    checkCancelled();
    const choice = body.choices?.[0];
    const content = String(choice?.message?.content || '');
    const calls = choice?.message?.tool_calls || [];
    const result = validate(content, calls, choice?.finish_reason);
    if (!calls.length && content) options.onText?.(content);
    return result;
  }
  if (!/text\/event-stream/i.test(response.headers.get('content-type') || '')) {
    await response.body?.cancel(); throw new ModelStreamError('模型接口未返回受支持的流式或 JSON 响应。');
  }
  const controller = new AbortController();
  const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
  const calls = new Map<number, any>(); let content = ''; let finish: unknown; let visible = false;
  try {
    for await (const chunk of Stream.fromSSEResponse<any>(response, controller)) {
      checkCancelled();
      const choice = chunk.choices?.find((item: any) => item.index === 0) || chunk.choices?.[0];
      if (!choice) continue;
      if (finish && (choice.delta?.content || choice.delta?.tool_calls?.length)) throw new ModelStreamError('模型在结束标记之后继续返回数据。');
      for (const delta of choice.delta?.tool_calls || []) {
        if (!Number.isInteger(delta.index) || delta.index < 0 || delta.index > 3) throw new ModelStreamError('无效的工具分片编号。');
        if (visible) { options.onReset?.(); visible = false; }
        const call = calls.get(delta.index) || { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (delta.id) { if (call.id && call.id !== delta.id) throw new ModelStreamError('工具 ID 在流中发生变化。'); call.id = delta.id; }
        if (delta.type && delta.type !== 'function') throw new ModelStreamError('不支持的工具类型。');
        call.function.name += delta.function?.name || '';
        call.function.arguments += delta.function?.arguments || '';
        if (call.function.arguments.length > 128_000 || call.function.name.length > 128) throw new ModelStreamError('工具参数超出安全范围。');
        calls.set(delta.index, call);
      }
      const text = choice.delta?.content;
      if (typeof text === 'string' && text) {
        content += text;
        if (content.length > 500_000) throw new ModelStreamError('单轮模型输出超过安全范围。');
        if (!calls.size) { options.onText?.(text); visible = true; }
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
    checkCancelled();
    return validate(content, [...calls.entries()].sort(([a], [b]) => a - b).map(([, value]) => value), finish);
  } catch (error) {
    checkCancelled();
    if (visible) options.onReset?.();
    throw error instanceof ModelStreamError ? error : new ModelStreamError(`模型流中断：${error instanceof Error ? error.message : '未知格式错误'}`);
  } finally { controller.abort(); signal?.removeEventListener('abort', abort); }
}
