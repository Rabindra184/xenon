import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import App from './App';

const mockResponse = (data: any) => ({
  json: () => Promise.resolve(data),
});

describe('App', () => {
  beforeEach(() => {
    global.fetch = jest.fn((input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/queue/length')) {
        return Promise.resolve(mockResponse(0));
      }
      if (url.includes('/device')) {
        return Promise.resolve(mockResponse([]));
      }
      if (url.includes('/session/') && url.includes('session_log')) {
        return Promise.resolve(mockResponse([]));
      }
      if (url.includes('/session')) {
        return Promise.resolve(mockResponse([]));
      }
      if (url.includes('/build')) {
        return Promise.resolve(mockResponse([]));
      }
      return Promise.resolve(mockResponse([]));
    }) as jest.Mock;
  });

  afterEach(() => {
    (global.fetch as jest.Mock).mockReset();
  });

  test('renders header and toggles sessions dashboard', async () => {
    render(<App />);
    expect(screen.getByText(/Xenon/i)).toBeInTheDocument();
    const sessionsTab = screen.getByRole('button', { name: /Sessions/i });
    fireEvent.click(sessionsTab);
    expect(await screen.findByText(/Sessions overview/i)).toBeInTheDocument();
  });
});
