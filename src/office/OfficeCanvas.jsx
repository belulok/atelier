import { useEffect, useRef } from 'react';
import createOffice from '../office3d/createOffice.js';

// Wraps the reference 3D office. `agents` come from the server (source of truth);
// presence callbacks give us screen positions for the HTML status bubbles.
export default function OfficeCanvas({ agents, selectedId, onPresence, onSelect, floorId, view, cameraRequest, onFloorSelect, onLift, onFloorLabels }) {
  const hostRef = useRef(null);
  const officeRef = useRef(null);
  const stateRef = useRef({ current: {} });

  stateRef.current.agents = agents;
  stateRef.current.selectedId = selectedId;
  stateRef.current.animate = true;
  stateRef.current.onPresence = onPresence;
  stateRef.current.onSelect = (agent) => onSelect?.(agent);
  stateRef.current.floorId = floorId;
  stateRef.current.view = view;
  stateRef.current.cameraRequest = cameraRequest;
  stateRef.current.onFloorSelect = onFloorSelect;
  stateRef.current.onLift = onLift;
  stateRef.current.onFloorLabels = onFloorLabels;

  useEffect(() => {
    const host = hostRef.current;
    const office = createOffice(host, stateRef, () => {}, () => {});
    officeRef.current = office;
    return () => office.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={hostRef} className="office-host" />;
}
