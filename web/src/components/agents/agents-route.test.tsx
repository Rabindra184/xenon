import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('./AgentsPage', () => ({ default: () => <h1>AGENTS PAGE</h1> }));

import { AppRoutes } from '../../routes';

describe('the AI agents route', () => {
  it('/agents opens the AI agents page, not the catch-all overview', async () => {
    render(
      <MemoryRouter initialEntries={['/agents']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'AGENTS PAGE' })).toBeInTheDocument();
  });
});
