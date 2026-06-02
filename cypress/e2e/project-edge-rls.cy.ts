/// <reference types="cypress" />

const url = Cypress.env('SUPABASE_URL');
const serviceKey = Cypress.env('SUPABASE_SERVICE_KEY');

describe('Edge project-command RLS', () => {
  if (!url || !serviceKey) {
    it('skipped - missing Supabase env', () => {
      cy.log('Set SUPABASE_URL and SUPABASE_SERVICE_KEY to run these tests.');
    });
    return;
  }

  it('rejects when org header mismatches project', () => {
    cy.request({
      method: 'POST',
      url: `${url}/functions/v1/project-command`,
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        'x-org-id': 'forbidden-org',
      },
      body: {
        type: 'change_task_status',
        projectId: 'non-existent',
        taskId: 't1',
        status: 'in_progress',
      },
      failOnStatusCode: false,
    }).then((resp) => {
      expect(resp.status).to.eq(403);
    });
  });
});
