import React from 'react';
import { Card, CardContent } from '../ui/Card';
import { cn } from '../ui/cn';

export type HubMetric = {
  labelFr: string;
  labelEn: string;
  value: string;
  hintFr?: string;
  hintEn?: string;
};

export type HubSection = {
  key: string;
  titleFr: string;
  titleEn: string;
  icon?: string;
  bulletsFr: string[];
  bulletsEn: string[];
};

export interface ModuleRichHubProps {
  isFr: boolean;
  metrics?: HubMetric[];
  sections?: HubSection[];
  className?: string;
}

const ModuleRichHub: React.FC<ModuleRichHubProps> = ({
  isFr,
  metrics = [],
  sections = [],
  className,
}) => {
  return (
    <Card className={cn('border-slate-200 shadow-sm', className)}>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              {isFr ? 'Hub opérationnel' : 'Operational hub'}
            </p>
            <p className="text-sm font-medium text-slate-800 mt-0.5">
              {isFr
                ? 'Indicateurs et synthèse de ce module.'
                : 'Indicators and summary for this module.'}
            </p>
          </div>
        </div>
        {metrics.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {metrics.map((m, i) => (
              <div key={`${m.labelFr}-${i}`} className="rounded-xl border border-slate-100 bg-slate-50/80 p-3">
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                  {isFr ? m.labelFr : m.labelEn}
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{m.value}</p>
                {(isFr ? m.hintFr : m.hintEn) ? (
                  <p className="mt-1 text-[10px] text-slate-500 leading-snug">{isFr ? m.hintFr : m.hintEn}</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        {sections.map((sec) => (
          <div key={sec.key} className="rounded-xl border border-slate-100 bg-white p-4">
            <h4 className="text-sm font-semibold text-slate-900 flex items-center gap-2 mb-2">
              {sec.icon ? <i className={cn(sec.icon, 'text-slate-400')} aria-hidden /> : null}
              {isFr ? sec.titleFr : sec.titleEn}
            </h4>
            <ul className="list-disc list-inside space-y-1 text-xs text-slate-600">
              {(isFr ? sec.bulletsFr : sec.bulletsEn).map((b, j) => (
                <li key={j}>{b}</li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};

export default ModuleRichHub;
