import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import GraphView from '../page';

// Mock 3D graph and Three.js libs used by the component to avoid DOM/WebGL requirements
jest.mock('3d-force-graph', () => {
  return () => {
    return (container: any) => {
      let _data: any = { nodes: [], links: [] };
      const api: any = {
        backgroundColor: () => api,
        nodeRelSize: () => api,
        nodeLabel: () => api,
        nodeThreeObjectExtend: () => api,
        nodeThreeObject: () => api,
        linkColor: () => api,
        linkOpacity: () => api,
        linkWidth: () => api,
        linkLabel: () => api,
        graphData: (d?: any) => {
          if (d !== undefined) {
            _data = d;
            return api;
          }
          return _data;
        },
        zoomToFit: () => {},
        onEngineStop: () => {}
      };
      return api;
    };
  };
});

jest.mock('three-spritetext', () => {
  return function SpriteTextMock(this: any, _text: string) {
    (this as any).color = '#fff';
    (this as any).textHeight = 12;
    return this;
  };
});

jest.mock('three', () => {
  class Dummy {}
  return {
    Group: class Group {},
    Mesh: class Mesh {},
    SphereGeometry: class SphereGeometry { constructor(..._args: any[]) {} },
    MeshBasicMaterial: class MeshBasicMaterial { constructor(..._args: any[]) {} },
    Color: class Color { setHSL() {} },
    Object3D: Dummy
  };
});

// Decorator is heavy; return data as-is for smoke tests
jest.mock('../decorateGraphData', () => ({
  __esModule: true,
  decorateGraphData: (data: any) => data
}));

function jsonResponse(data: any, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => data
  } as Response;
}

describe('GraphView component', () => {
  beforeEach(() => {
    // default URL
    window.history.pushState({}, '', '/graphview');
    // reset fetch
    (global as any).fetch = jest.fn();
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  test('URL initialization and defaults: collection from URL and default mode=client; Seeds tooltip present', async () => {
    // Given URL with collection=8 and without mode
    window.history.pushState({}, '', '/graphview?collection=8');
    // Mock preload fetch with minimal ok result
    (global as any).fetch = jest.fn().mockResolvedValueOnce(
      jsonResponse({ nodes: [], links: [] }, true, 200)
    );

    render(<GraphView />);

    const collectionInput = await screen.findByTestId('input-collection');
    const modeSelect = await screen.findByTestId('select-mode');
    const seedsInput = await screen.findByTestId('input-seeds');

    expect((collectionInput as HTMLInputElement).value).toBe('8');
    expect((modeSelect as HTMLSelectElement).value).toBe('client');
    expect((seedsInput as HTMLInputElement).getAttribute('title')).toBe(
      'Comma-separated Neo4j node ids used as personalization seeds (stringified ids).'
    );
  });

  test('preload + auto-seed behavior; Load enabled in client mode with initially empty seeds', async () => {
    window.history.pushState({}, '', '/graphview?collection=8');
    // Preload returns two nodes; auto-seed should pick one id
    (global as any).fetch = jest.fn().mockResolvedValueOnce(
      jsonResponse({ nodes: [{ id: 'n1', label: 'X' }, { id: 'n2', label: 'Y' }], links: [] }, true, 200)
    );

    render(<GraphView />);

    const loadBtn = await screen.findByTestId('btn-load');
    // Even if seeds initially empty, client validation should allow clicking
    expect((loadBtn as HTMLButtonElement).disabled).toBe(false);

    const seedsInput = await screen.findByTestId('input-seeds');
    // Wait for auto-seed and preload ok status
    await waitFor(() => {
      const v = (seedsInput as HTMLInputElement).value;
      expect(['n1', 'n2']).toContain(v);
    });
    await waitFor(() => {
      expect(screen.getByText(/Preload: Ok/)).toBeTruthy();
    });
  });

  test('server-mode validation: empty seeds -> validation error and Load disabled', async () => {
    window.history.pushState({}, '', '/graphview?collection=8');
    // Preload returns no nodes so auto-seed will not fill anything
    (global as any).fetch = jest.fn().mockResolvedValueOnce(
      jsonResponse({ nodes: [], links: [] }, true, 200)
    );

    render(<GraphView />);

    const modeSelect = await screen.findByTestId('select-mode');
    const loadBtn = await screen.findByTestId('btn-load');
    const seedsInput = await screen.findByTestId('input-seeds');

    // Ensure seeds empty
    expect((seedsInput as HTMLInputElement).value).toBe('');

    // Switch to server mode
    fireEvent.change(modeSelect, { target: { value: 'server' } });

    await waitFor(() => {
      expect(screen.getByText(/Validation: Seeds are required for server mode/)).toBeTruthy();
      expect((loadBtn as HTMLButtonElement).disabled).toBe(true);
    });
  });

  test('client fail-fast on Load without seeds and without preload', async () => {
    window.history.pushState({}, '', '/graphview?collection=8');
    // Make preload fail with error to set preloadStatus=Error and preloadNodes=null
    (global as any).fetch = jest.fn().mockResolvedValueOnce(
      jsonResponse({ error: 'Oops' }, false, 500)
    );

    render(<GraphView />);

    // Ensure preload error shown
    await waitFor(() => {
      expect(screen.getByText(/Preload: Error/)).toBeTruthy();
    });

    const seedsInput = await screen.findByTestId('input-seeds');
    expect((seedsInput as HTMLInputElement).value).toBe('');

    const loadBtn = await screen.findByTestId('btn-load');
    fireEvent.click(loadBtn);

    await waitFor(() => {
      expect(screen.getByText(/Error: Missing seeds for client mode/)).toBeTruthy();
    });
    // Only preload call should have been made; load path returns early
    expect((global as any).fetch).toHaveBeenCalledTimes(1);
  });

  test('preload error observability: logs contain server error message', async () => {
    window.history.pushState({}, '', '/graphview?collection=8');
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    (global as any).fetch = jest.fn().mockResolvedValueOnce(
      jsonResponse({ error: 'Boom' }, false, 502)
    );

    render(<GraphView />);

    await waitFor(() => {
      expect(screen.getByText(/Preload: Error/)).toBeTruthy();
    });
    // Assert that one of error logs contains 'Boom'
    const hadBoom = (errorSpy.mock.calls || []).some((call) => String(call[0]).includes('Boom'));
    expect(hadBoom).toBe(true);
    errorSpy.mockRestore();
  });

  test('successful client compute path smoke: loads and renders, status shows Loaded (client)', async () => {
    window.history.pushState({}, '', '/graphview?collection=8');
    // Preload ok (no need for nodes since we will provide seeds manually)
    (global as any).fetch = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ nodes: [], links: [] }, true, 200)) // preload
      .mockResolvedValueOnce( // load call
        jsonResponse({ nodes: [{ id: 'n1', label: 'X' }], links: [] }, true, 200)
      );

    render(<GraphView />);

    const seedsInput = await screen.findByTestId('input-seeds');
    fireEvent.change(seedsInput, { target: { value: 'n1' } });

    const loadBtn = await screen.findByTestId('btn-load');
    fireEvent.click(loadBtn);

    const graphContainer = await screen.findByTestId('graph-container');
    expect(graphContainer).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText(/Loaded \(client\):/)).toBeTruthy();
    });
  });
})