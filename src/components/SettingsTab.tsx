import { useT } from '../i18n';
import { Card, SectionTitle } from './common';

/** Rarely needed switches. The data and build stamp sit at the very end of the page. */
export function SettingsTab({ school, autoSchool, onSchool, onSchoolReset, generatedAt }: { school: boolean; autoSchool: boolean; onSchool: (v: boolean) => void; onSchoolReset: () => void; generatedAt: string | null }) {
  const { t } = useT();
  return (
    <div className="flex flex-col gap-4" data-testid="settings">
      <section>
        <SectionTitle>{t('settingsTimetable')}</SectionTitle>
        <Card className="flex flex-col gap-3">
          <label className="inline-flex min-h-10 cursor-pointer items-center gap-3 font-medium">
            <input type="checkbox" className="peer sr-only" checked={school} onChange={(e) => onSchool(e.target.checked)} />
            <span className="relative h-6 w-11 shrink-0 rounded-full bg-slate-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:transition-transform peer-checked:bg-sky-600 peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-sky-500 dark:bg-slate-600" />
            <span>
              {school ? t('schoolPeriod') : t('schoolHolidays')}
              {school === autoSchool && <span className="ml-1.5 text-sm font-normal text-slate-400">({t('schoolAuto')})</span>}
            </span>
          </label>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('schoolHint')}</p>
          {school !== autoSchool && (
            <button className="min-h-10 self-start rounded-md text-sm font-medium text-sky-700 underline dark:text-sky-300" onClick={onSchoolReset}>
              {t('schoolReset')}
            </button>
          )}
        </Card>
      </section>
      {generatedAt && (
        <p className="mt-6 text-center text-xs text-slate-400">
          {t('dataFrom')} {generatedAt.slice(0, 10)}
          <br />
          <span data-testid="build-info">
            v{__APP_VERSION__} · Build: {__BUILD_TIME__}
          </span>
        </p>
      )}
    </div>
  );
}
