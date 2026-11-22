export function registerExtraRegions(targetBucket, modules = []) {
  if (!targetBucket || !Array.isArray(modules)) return targetBucket;
  for (let i = 0; i < modules.length; i++) {
    const mod = modules[i];
    if (!mod) continue;
    if (Array.isArray(mod.blockers) && Array.isArray(targetBucket.blockers)) {
      for (let j = 0; j < mod.blockers.length; j++) {
        targetBucket.blockers.push(mod.blockers[j]);
      }
    }
    if (Array.isArray(mod.targets) && Array.isArray(targetBucket.targets)) {
      for (let j = 0; j < mod.targets.length; j++) {
        targetBucket.targets.push(mod.targets[j]);
      }
    }
  }
  return targetBucket;
}
