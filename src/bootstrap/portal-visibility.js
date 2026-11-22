export function createPortalVisibility({
  world,
  cliff,
  interiorGroups = [],
  exteriorGroups = [],
  conditionalExterior = []
} = {}) {
  const intList = [];
  const extList = [];
  const condExtList = [];
  const intSet = new Set();
  const extSet = new Set();

  function addInterior(group) {
    if (!group || intSet.has(group)) return group;
    intSet.add(group);
    intList.push(group);
    return group;
  }

  function addExterior(group) {
    if (!group || extSet.has(group)) return group;
    extSet.add(group);
    extList.push(group);
    return group;
  }

  for (const g of interiorGroups) addInterior(g);
  for (const g of exteriorGroups) addExterior(g);
  for (const entry of conditionalExterior) {
    if (entry?.group) condExtList.push(entry);
  }

  const cliffCenter = world?.cliff?.center || [0, 0];
  const cliffRadius = world?.cliff?.radius ?? 100;
  const cliffFlankZ = cliffCenter[1] + Math.sin(world?.cliff?.arcFrom ?? 0.55) * cliffRadius;
  const cx = cliffCenter[0];
  const cz = cliffCenter[1];
  const rOut = cliffRadius + 22;
  const rIn = cliffRadius - 22;
  const slitX = cliff?.slit?.x ?? 0;
  const slitZ = cliff?.slit?.z ?? 0;

  const _state = { slitDist: 0, hideExterior: false, hideInterior: false };

  function update(camera, isFlying = false) {
    const px = camera?.position?.x ?? 0;
    const py = camera?.position?.y ?? 0;
    const pz = camera?.position?.z ?? 0;

    const slitDist = Math.hypot(px - slitX, pz - slitZ);
    const camR = Math.hypot(px - cx, pz - cz);
    const portalActive = !isFlying && slitDist > 26 && py < 18;
    const hideExterior = portalActive && camR > rOut && pz > cliffFlankZ + 12;
    const hideInterior = portalActive && (camR < rIn || pz < cliffFlankZ - 14);

    for (let i = 0; i < intList.length; i++) {
      intList[i].visible = !hideExterior;
    }
    for (let i = 0; i < extList.length; i++) {
      extList[i].visible = !hideInterior;
    }
    for (let i = 0; i < condExtList.length; i++) {
      const item = condExtList[i];
      item.group.visible = !hideInterior && Boolean(item.isVisible?.());
    }

    _state.slitDist = slitDist;
    _state.hideExterior = hideExterior;
    _state.hideInterior = hideInterior;
    return _state;
  }

  return {
    interiorGroups: intList,
    exteriorGroups: extList,
    addInterior,
    addExterior,
    update
  };
}
