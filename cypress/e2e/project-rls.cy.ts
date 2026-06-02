describe('RLS projects/tasks (placeholder)', () => {
  it.skip('refuse l’accès hors organisation', () => {
    // TODO: inject JWT d’une autre org et vérifier 403 sur projects/tasks/read models
  });

  it.skip('autorise l’accès dans la même organisation', () => {
    // TODO: JWT organisation valide -> select projects/tasks/read models ok
  });
});
