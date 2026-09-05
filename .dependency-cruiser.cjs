// .dependency-cruiser.cjs
// Replaces: ArchUnit test classes (ArchitectureTest.java)
// Enforces architecture rules on the import/dependency graph

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // RULE 1: No circular dependencies
    // ArchUnit: slices().should().beFreeOfCycles()
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular deps make code untestable and hard to reason about",
      from: {},
      to: { circular: true },
    },

    // RULE 2: Routes cannot import other routes
    // ArchUnit: noClasses().resideInAPackage("..controller..")
    //   .should().dependOnClassesThat().resideInAPackage("..controller..")
    {
      name: "no-route-to-route",
      severity: "error",
      comment: "Routes must be independent — orchestrate via shared services only",
      from: { path: "^src/routes/" },
      to: { path: "^src/routes/" },
    },

    // RULE 3: Config is a leaf module — no internal deps
    // ArchUnit: classes in "config" should not depend on "controller" or "service"
    {
      name: "config-is-standalone",
      severity: "error",
      comment: "Config must not import from routes or server (leaf module)",
      from: { path: "^src/config\\.ts$" },
      to: { path: "^src/(routes|server)" },
    },

    // RULE 4: Production code must not import devDependencies
    // ArchUnit: productionClasses should not depend on testLibraries
    {
      name: "no-dev-deps-in-production",
      severity: "error",
      comment: "src/ must not import devDependencies (only dependencies)",
      from: { path: "^src/" },
      to: { dependencyTypes: ["npm-dev"] },
    },

    // RULE 5: No orphan modules (files that nothing imports)
    // Catches dead code — like PMD's UnusedPrivateMethod but for whole files
    {
      name: "no-orphans",
      severity: "warn",
      comment: "Modules that nothing imports are likely dead code",
      from: { orphan: true, path: "^src/", pathNot: "^src/server\\.ts$" },
      to: {},
    },
  ],

  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    doNotFollow: { path: "node_modules" },
  },
};
