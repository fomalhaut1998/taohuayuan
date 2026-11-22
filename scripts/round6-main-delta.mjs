// Later feature additions are removed only for historical integration snapshots.
// The independent round6 gate requires each block exactly once and byte-identical restoration.
export const ROUND6_BLOCKS = ['imports', 'scene', 'actors', 'updates', 'debug'];
export function stripRound6Main(source) {
  for (const name of ROUND6_BLOCKS) {
    const start = '// Round 6: ' + name + ' begin\n';
    const end = '// Round 6: ' + name + ' end\n';
    const from = source.indexOf(start), to = source.indexOf(end, from);
    if (from >= 0 && to >= from) source = source.slice(0, from) + source.slice(to + end.length);
  }
  return source.replace(', pondLife.blockers, waterworks.blockers, leisureGrove.blockers', '')
    .replace('  pondLife, waterworks, leisureGrove,\n', '');
}
