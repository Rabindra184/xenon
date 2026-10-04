import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AISettings } from './ai-settings';
import { ToastProvider } from '../ui/toast';
import XenonApiService from '../../api-service';

/**
 * The AI engine page. Through 2.14 it showed Temperature, Max tokens and Top P
 * controls that no AI call ever read and that were never saved, said "Default"
 * beside every model, configured or not, and told the person to set
 * XENON_OLLAMA_API_KEY, which doesn't exist (Ollama needs no key). The provider
 * it chose was forgotten at the next restart; the server keeps it now.
 */

vi.mock('../../api-service', () => ({
  default: {
    getGlobalConfig: vi.fn(),
    updateGlobalConfig: vi.fn().mockResolvedValue({ success: true }),
    testAIConfig: vi.fn().mockResolvedValue({ success: true, message: 'Connected' }),
  },
}));

const api = () => vi.mocked(XenonApiService);

const SERVER = {
  aiProvider: 'gemini',
  geminiSet: true,
  openaiSet: true,
  anthropicSet: true,
};

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <AISettings />
      </ToastProvider>
    </MemoryRouter>,
  );
}

/** The value cell of a row of the "Runtime configuration" card. */
async function row(label: string) {
  const name = await screen.findByText(label, { selector: '.ai-config-label' });
  return name.closest('.ai-config-row') as HTMLElement;
}

beforeEach(() => {
  api().getGlobalConfig.mockResolvedValue(SERVER);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AI engine page', () => {
  it('has no temperature, max tokens or top P controls: nothing used them', async () => {
    renderPage();
    await row('Model');
    expect(screen.queryByLabelText(/temperature/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/max tokens/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/top p/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/model parameters/i)).not.toBeInTheDocument();
  });

  describe('the model', () => {
    it("shows the provider's own default, marked Default, when the server sets none", async () => {
      renderPage();
      const model = await row('Model');
      expect(within(model).getByText('gemini-3-flash-preview')).toBeInTheDocument();
      expect(within(model).getByText('Default')).toBeInTheDocument();
    });

    it('shows the model the server sets for the provider, not marked Default', async () => {
      api().getGlobalConfig.mockResolvedValue({ ...SERVER, geminiModel: 'gemini-2.5-pro' });
      renderPage();
      const model = await row('Model');
      expect(within(model).getByText('gemini-2.5-pro')).toBeInTheDocument();
      expect(within(model).queryByText('Default')).not.toBeInTheDocument();
    });

    it('shows the model the server sets for every provider, not marked Default', async () => {
      api().getGlobalConfig.mockResolvedValue({
        ...SERVER,
        aiProvider: 'anthropic',
        aiModel: 'claude-opus-4-1',
      });
      renderPage();
      const model = await row('Model');
      expect(within(model).getByText('claude-opus-4-1')).toBeInTheDocument();
      expect(within(model).queryByText('Default')).not.toBeInTheDocument();
    });

    it("follows the provider chosen on the page, with that provider's model", async () => {
      api().getGlobalConfig.mockResolvedValue({ ...SERVER, openaiModel: 'gpt-4.1' });
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: /openai/i }));
      const model = await row('Model');
      expect(within(model).getByText('gpt-4.1')).toBeInTheDocument();
      expect(within(model).queryByText('Default')).not.toBeInTheDocument();
    });
  });

  describe('the base URL', () => {
    it('is shown for Ollama, with the address the server uses', async () => {
      api().getGlobalConfig.mockResolvedValue({
        ...SERVER,
        aiProvider: 'ollama',
        aiBaseUrl: 'http://gpu-box.lab:11434',
      });
      renderPage();
      const baseUrl = await row('Base URL');
      expect(within(baseUrl).getByText('http://gpu-box.lab:11434')).toBeInTheDocument();
      expect(within(baseUrl).queryByText('Default')).not.toBeInTheDocument();
    });

    it("is not shown for a provider that doesn't use one", async () => {
      api().getGlobalConfig.mockResolvedValue({
        ...SERVER,
        aiProvider: 'anthropic',
        aiBaseUrl: 'http://gpu-box.lab:11434',
      });
      renderPage();
      await row('Model');
      expect(screen.queryByText('Base URL')).not.toBeInTheDocument();
      expect(screen.queryByText('http://gpu-box.lab:11434')).not.toBeInTheDocument();
    });
  });

  describe('a provider that is not set up', () => {
    it("says what Ollama needs, which isn't a key", async () => {
      renderPage();
      const ollama = await screen.findByRole('button', { name: /ollama/i });
      expect(ollama).toBeDisabled();
      const hint = ollama.getAttribute('title') ?? '';
      expect(hint).not.toMatch(/XENON_OLLAMA_API_KEY/);
      expect(hint).toMatch(/XENON_OLLAMA_MODEL/);
    });

    it('names the key a cloud provider needs, one the server reads', async () => {
      api().getGlobalConfig.mockResolvedValue({ ...SERVER, openaiSet: false });
      renderPage();
      const openai = await screen.findByRole('button', { name: /openai/i });
      expect(openai).toBeDisabled();
      expect(openai.getAttribute('title')).toMatch(/XENON_OPENAI_API_KEY/);
    });
  });

  it('saves only the provider', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /anthropic/i }));
    fireEvent.click(await screen.findByRole('button', { name: /save configuration/i }));

    await waitFor(() => expect(api().updateGlobalConfig).toHaveBeenCalled());
    expect(api().updateGlobalConfig.mock.calls[0][0]).toEqual({ aiProvider: 'anthropic' });
  });

  it('offers no save when nothing was changed', async () => {
    renderPage();
    await row('Model');
    expect(screen.queryByRole('button', { name: /save configuration/i })).not.toBeInTheDocument();
  });
});
