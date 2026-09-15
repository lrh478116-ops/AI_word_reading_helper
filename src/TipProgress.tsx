import { useEffect, useState } from 'react';
import { TIP_STAGE_LABELS, type TipStage } from './tip-progress';
export function TipProgress({ stage, language }: { stage: TipStage; language: string }) {
  const [started] = useState(() => Date.now());
  const [seconds, setSeconds] = useState(0);
  useEffect(() => { const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000); return () => clearInterval(timer); }, [started]);
  const en = language === 'en';
  return <div className="tip-progress" data-tip-stage={stage}>
    <span role="status">{TIP_STAGE_LABELS[stage][en ? 1 : 0]}</span>
    <small>{en ? `Elapsed: ${seconds}s` : `已等待 ${seconds} 秒`}</small>
    {seconds >= 15 && <p>{en ? 'A model’s first response or a tool may take longer. You can stop this request.' : '模型首次响应或工具处理可能需要较长时间，可点击停止生成。'}</p>}
  </div>;
}
