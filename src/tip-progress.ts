export const TIP_STAGES = ['preparing', 'assessing', 'searching', 'planning', 'tool', 'answering', 'reviewing'] as const;
export type TipStage = typeof TIP_STAGES[number];
export const isTipStage = (value: unknown): value is TipStage => typeof value === 'string' && (TIP_STAGES as readonly string[]).includes(value);
export const TIP_STAGE_LABELS: Record<TipStage, [string, string]> = {
  preparing: ['正在准备文档上下文', 'Preparing document context'],
  assessing: ['正在分析问题', 'Assessing your question'],
  searching: ['正在检索与读取资料', 'Searching and reading sources'],
  planning: ['模型正在选择工具或组织回答', 'The model is selecting tools or composing an answer'],
  tool: ['正在执行工具', 'Running a tool'],
  answering: ['正在生成回答', 'Generating the answer'],
  reviewing: ['正在核对回答与引用', 'Checking the answer and citations'],
};
