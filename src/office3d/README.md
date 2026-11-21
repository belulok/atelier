# 3D workspace

The running Three.js scene is adapted from `reference/office3d/`, which remains
unchanged. `createOffice.js` renders an active floor or an overview of all four
levels. Only the active floor uses the detailed furniture and animated characters;
the building overview uses lighter geometry.

- `buildingShell.js`: four stacked floors, clickable floor geometry, lift, and
  markers projected into the React overlay.
- `room.js`: floor colours and signage, a reception/lounge on the ground floor,
  shared amenities, and a cutaway lift on every level.
- `character.js`: people have hair and a badge; agents have an antenna. The user
  has a persistent selection ring.
- `behavior.js`: original walking, work, social and approval behaviours, plus
  lobby destinations and explicit desk assignments for sample coworkers.
- `navigation.js`: the existing walkable grid for the detailed office.

`src/office/OfficeExperience.jsx` owns floor navigation, lift transitions, work
sessions, the people directory and camera controls. `src/office/building.js`
contains the floor definitions, sample organisation and mapping of the four
existing server agents to their floors. Live workflow state still comes from SSE;
the organisation's other people and agents are explicitly simulated.

The work-session start time and current floor persist in browser local storage.
There is no authentication or shared multiplayer presence in this simulation.
Reduced-motion preferences disable travel and character animation. Keyboard users
can use the floor rail, camera controls and native lift dialog without the canvas.
