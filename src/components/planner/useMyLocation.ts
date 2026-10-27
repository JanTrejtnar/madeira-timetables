import { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n';
import { localStopName } from '../../lib/text';
import { PICK_RADIUS_M, nearestNode } from '../../lib/network';
import { geoDeniedText } from '../../lib/geoHelp';
import { walkTo } from '../../lib/walk';
import type { Shared } from '../common';

/**
 * "My location": the position is asked for, then the nearest stop (within 1 km) becomes the start and the walk to it is shown under the field.
 * `locNote` is that note (or an error), `clearNote` removes it when the start is changed by hand.
 */
export function useMyLocation(shared: Shared) {
  const { t, lang } = useT();
  const { userPos, geo, locate, setPlanner } = shared;
  const [wantsLocation, setWantsLocation] = useState(false);
  const [locNote, setLocNote] = useState<string | null>(null);
  const seenFix = useRef(userPos?.seq);
  const locateMe = () => {
    setWantsLocation(true);
    setLocNote(null);
    locate();
  };
  useEffect(() => {
    if (!wantsLocation) return;
    if (geo === 'denied' || geo === 'error' || geo === 'unsupported') {
      setWantsLocation(false);
      setLocNote(geo === 'denied' ? geoDeniedText(t) : t(geo === 'error' ? 'geoError' : 'geoUnsupported'));
      return;
    }
    if (!userPos || userPos.seq === seenFix.current) return;
    seenFix.current = userPos.seq;
    setWantsLocation(false);
    const hit = nearestNode(shared.net, userPos.lat, userPos.lon, PICK_RADIUS_M);
    if (!hit) return setLocNote(t('pickNone', { m: PICK_RADIUS_M }));
    const name = localStopName(hit.node.name, lang);
    const w = walkTo(userPos, hit.node);
    setPlanner((f) => ({ ...f, from: { text: t('myLocationText', { name }), key: hit.node.key, pt: { lat: +userPos.lat.toFixed(5), lon: +userPos.lon.toFixed(5) } } }));
    setLocNote(w ? t('nearestStopWalk', { name, m: w.m, n: w.min }) : null);
  }, [wantsLocation, geo, userPos, shared.net, t, lang, setPlanner]);
  return { locNote, clearNote: () => setLocNote(null), locateMe, locating: geo === 'busy' };
}
