import { createServer } from "vite";

const server = await createServer({ configFile: false, logLevel: "silent", server: { middlewareMode: true, watch: null, hmr: false, ws: false } });
try {
  const { discoveryDate, discoveryFixture } = await server.ssrLoadModule("/tests/fixtures/discovery.ts");
  const { discoveryPool, explore, discoveryProtocol } = await server.ssrLoadModule("/src/domain/discovery.ts");
  const { discoveryModes } = await server.ssrLoadModule("/src/shared/discovery.ts");
  const { catalogue, signals, excluded } = discoveryFixture;
  const rotation = { previous: [], adjacent: [] };
  const firstSeed = "fixture-v1";
  const secondSeed = "second";
  const eligible = discoveryPool(catalogue, excluded, discoveryDate);
  const unique = (items) => new Set(items).size;
  const ids = (result) => result.selected.map(({ film }) => film.id);
  const distribution = (values) => {
    const known = values.filter((value) => value !== undefined).sort((a, b) => a - b);
    const median = !known.length ? null : (known[Math.floor((known.length - 1) / 2)] + known[Math.floor(known.length / 2)]) / 2;
    return { known: known.length, unknown: values.length - known.length, min: known[0] ?? null, median, max: known.at(-1) ?? null };
  };
  const affinities = (result) => ({
    ...distribution(result.selected.map(({ fit }) => Number(fit.toFixed(3)))),
    negative: result.selected.filter(({ fit }) => fit < 0).length,
    belowMinusOne: result.selected.filter(({ fit }) => fit < -1).length,
  });
  const trials = discoveryModes.map((mode) => {
    const result = explore(catalogue, signals, excluded, mode, rotation, firstSeed, discoveryDate);
    const films = result.selected.map(({ film }) => film);
    const next = explore(catalogue, signals, excluded, mode, { ...rotation, previous: [ids(result)] }, secondSeed, discoveryDate);
    return {
      mode, ids: ids(result), next: ids(next), renewed: next.renewed,
      diversity: {
        genres: unique(films.flatMap(({ metadata }) => metadata.genres)),
        countries: unique(films.flatMap(({ metadata }) => metadata.countries)),
        directors: unique(films.flatMap(({ metadata }) => metadata.directors)),
        decades: unique(films.flatMap(({ year }) => year ? [Math.floor(year / 10) * 10] : [])),
      },
      popularity: distribution(films.map(({ metadata }) => metadata.popularity)),
      discoveryAffinity: affinities(result),
      nextDiscoveryAffinity: affinities(next),
      picks: result.selected.map(({ film, reason }) => ({ title: film.title, reason })),
    };
  });
  process.stdout.write(JSON.stringify({
    protocol: discoveryProtocol, date: discoveryDate, firstSeed, secondSeed, catalogue: catalogue.length, eligible: eligible.length,
    excluded: catalogue.filter(({ id }) => !eligible.some((film) => film.id === id)).map(({ id }) => id),
    coverage: { first: unique(trials.flatMap(({ ids }) => ids)), firstAndNext: unique(trials.flatMap(({ ids, next }) => [...ids, ...next])) },
    overlap: trials.flatMap((a, index) => trials.slice(index + 1).map((b) => ({
      modes: [a.mode, b.mode], shared: a.ids.filter((id) => b.ids.includes(id)).length,
      sharedAfterRenewal: a.next.filter((id) => b.next.includes(id)).length,
    }))),
    trials,
  }, null, 2) + "\n");
} finally {
  await server.close();
}
