import { useState } from 'react';
import { useT } from '../i18n';
import type { Picked } from '../lib/plannerForm';
import type { Shared } from './common';
import { ConnectionDetail } from './Connection';
import { MapPicker, RouteMap } from './LazyMaps';
import { TripShortcuts } from './TripShortcuts';
import { ConnectionList } from './planner/ConnectionList';
import { EstimatedNote, ResultNotices } from './planner/ResultNotices';
import { SearchForm } from './planner/SearchForm';
import { SearchSummary } from './planner/SearchSummary';
import { useConnectionMap } from './planner/useConnectionMap';
import { useMyLocation } from './planner/useMyLocation';
import { usePlanner } from './planner/usePlanner';

// The journey planner page. State and search live in planner/usePlanner (the search itself in lib/plannerSearch), the map of the selected
// connection in planner/useConnectionMap, "my location" in planner/useMyLocation; this component puts the pieces together.
export function PlannerTab({ shared }: { shared: Shared }) {
  const { t } = useT();
  const { from, to } = shared.planner;
  const p = usePlanner(shared);
  const loc = useMyLocation(shared);
  const layers = useConnectionMap(shared, p.selected, p.fromPtOf, p.toPtOf);
  const [pickFor, setPickFor] = useState<'from' | 'to' | null>(null);
  const setFrom = (v: Picked) => {
    loc.clearNote();
    p.patch({ from: v });
  };
  const setTo = (v: Picked) => p.patch({ to: v });
  const estimatedNote = p.anyEstimated ? <EstimatedNote /> : null;

  if (p.opened) {
    return (
      <ConnectionDetail
        it={p.opened.it}
        shared={shared}
        base={p.date}
        onBack={p.closeConnection}
        fromPt={p.fromPtOf(p.opened.it)}
        toPt={p.toPtOf(p.opened.it)}
        map={!shared.desktop && layers ? <div data-testid="planner-map"><RouteMap layers={layers} /></div> : null}
        estimatedNote={estimatedNote}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {!p.searched && <SearchForm shared={shared} p={p} setFrom={setFrom} setTo={setTo} onPickMap={setPickFor} locNote={loc.locNote} onLocate={loc.locateMe} locating={loc.locating} />}
      {!p.searched && <TripShortcuts shared={shared} />}
      {p.searched && <SearchSummary shared={shared} p={p} />}
      <ResultNotices shared={shared} searched={p.searched} pending={p.pending} result={p.result} empty={p.empty} onResetFilters={() => p.patch({ ops: [], directOnly: false, type: 'all' })} />
      <ConnectionList shared={shared} p={p} />
      {estimatedNote}
      {pickFor && (
        <MapPicker
          shared={shared}
          title={pickFor === 'from' ? t('from') : t('to')}
          kind={pickFor}
          current={pickFor === 'from' ? from : to}
          onPick={(v) => (pickFor === 'from' ? setFrom(v) : setTo(v))}
          onClose={() => setPickFor(null)}
        />
      )}
    </div>
  );
}
