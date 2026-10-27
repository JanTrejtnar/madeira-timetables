import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { cachesAvailable, downloadArchive, fmtBytes, probeArchive, readInstalled, removeArchive, requestPersistence, storageStatus, type InstalledPack, type Probe, type StorageStatus } from '../lib/offlineMaps';
import { Card, SectionTitle } from './common';

type View =
  | { kind: 'checking' }
  | { kind: 'none'; probe: Probe }
  | { kind: 'downloading'; done: number; total: number }
  | { kind: 'installed'; pack: InstalledPack; newer: Probe | null }
  | { kind: 'hidden' };

/**
 * Settings → Offline maps: downloads the map pack (one PMTiles file) into the device, shows its size and the room left, and deletes it.
 * Hidden while the server has no pack (so the page offers nothing it cannot deliver) and where Cache Storage does not exist.
 */
export function OfflineMaps() {
  const { t } = useT();
  const [view, setView] = useState<View>({ kind: 'checking' });
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!cachesAvailable()) return setView({ kind: 'hidden' });
    const [pack, probe] = await Promise.all([readInstalled().catch(() => null), probeArchive(undefined, undefined, AbortSignal.timeout(6000)).catch(() => null)]);
    setStorage(await storageStatus());
    if (pack) setView({ kind: 'installed', pack, newer: probe && probe.version !== pack.version ? probe : null });
    else setView(probe ? { kind: 'none', probe } : { kind: 'hidden' });
  }, []);
  useEffect(() => {
    void refresh();
    return () => abort.current?.abort();
  }, [refresh]);

  const download = async (probe: Probe) => {
    setError(null);
    // room for the pack and some to spare; a refusal later (quota) is reported just the same
    const status = await storageStatus();
    if (status && status.quota && status.quota - status.usage < probe.size * 1.2) {
      setError(t('offlineMapsNoSpace', { need: fmtBytes(probe.size), free: fmtBytes(Math.max(0, status.quota - status.usage)) }));
      return;
    }
    void requestPersistence();
    const ctl = new AbortController();
    abort.current = ctl;
    setView({ kind: 'downloading', done: 0, total: probe.size });
    try {
      await downloadArchive({ signal: ctl.signal, onProgress: (p) => setView({ kind: 'downloading', done: p.done, total: p.total }) });
    } catch (e) {
      if (!ctl.signal.aborted) setError(t('offlineMapsError'));
      console.warn('Offline map download stopped:', e);
    }
    abort.current = null;
    await refresh();
  };
  const remove = async () => {
    await removeArchive();
    await refresh();
  };

  if (view.kind === 'hidden' || view.kind === 'checking') return null;
  const percent = view.kind === 'downloading' ? Math.min(100, Math.floor((view.done / Math.max(1, view.total)) * 100)) : 0;
  const button = 'min-h-11 rounded-xl px-4 text-sm font-semibold transition-colors';
  const primary = `${button} bg-sky-600 text-white hover:bg-sky-700 active:bg-sky-800 disabled:opacity-40`;
  const secondary = `${button} border border-slate-200 text-sky-700 hover:bg-sky-50 dark:border-slate-700 dark:text-sky-300 dark:hover:bg-slate-800`;
  return (
    <section data-testid="offline-maps">
      <SectionTitle>{t('offlineMapsTitle')}</SectionTitle>
      <Card className="flex flex-col gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('offlineMapsHint')}</p>
        {view.kind === 'none' && (
          <button type="button" className={`${primary} self-start`} onClick={() => void download(view.probe)} data-testid="offline-download">
            {t('offlineMapsDownload', { size: fmtBytes(view.probe.size) })}
          </button>
        )}
        {view.kind === 'downloading' && (
          <>
            <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t('offlineMapsTitle')} className="h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" data-testid="offline-progress">
              <div className="h-full rounded-full bg-sky-600 transition-[width]" style={{ width: `${percent}%` }} />
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300" data-testid="offline-status">
              {t('offlineMapsProgress', { done: fmtBytes(view.done), total: fmtBytes(view.total), percent })}
            </p>
            <button type="button" className={`${secondary} self-start`} onClick={() => abort.current?.abort()} data-testid="offline-cancel">
              {t('offlineMapsCancel')}
            </button>
          </>
        )}
        {view.kind === 'installed' && (
          <>
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300" data-testid="offline-status">
              {t('offlineMapsInstalled', { size: fmtBytes(view.pack.size) })}
            </p>
            <div className="flex flex-wrap gap-2">
              {view.newer && (
                <button type="button" className={primary} onClick={() => void download(view.newer!)} data-testid="offline-update">
                  {t('offlineMapsUpdate', { size: fmtBytes(view.newer.size) })}
                </button>
              )}
              <button type="button" className={secondary} onClick={() => void remove()} data-testid="offline-remove">
                {t('offlineMapsRemove')}
              </button>
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-amber-700 dark:text-amber-300" data-testid="offline-error">
            {error}
          </p>
        )}
        {storage && storage.quota > 0 && (
          <p className="text-xs text-slate-400" data-testid="offline-storage">
            {t('offlineMapsStorage', { used: fmtBytes(storage.usage), quota: fmtBytes(storage.quota) })}
          </p>
        )}
      </Card>
    </section>
  );
}
