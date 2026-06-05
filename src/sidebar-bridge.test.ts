import { describe, expect, test } from "bun:test";
import {
  activeWorkspaceId,
  bindSidebarBridge,
  createFileBrowserState,
  type AppElement,
  type PluginContext,
  type SidebarApi,
  type SidebarSnapshot,
  type SubjectLike,
  type SubscriptionLike,
} from "./index";

class TestSubject implements SubjectLike<SidebarSnapshot> {
  public activeWorkspaceId: string;
  public subscribeCount = 0;
  public unsubscribeCount = 0;
  public latestSubscription?: SubscriptionLike;

  public constructor(activeWorkspaceId: string) {
    this.activeWorkspaceId = activeWorkspaceId;
  }

  public subscribe(callback: (value: SidebarSnapshot) => void): SubscriptionLike {
    this.subscribeCount += 1;
    callback({ activeWorkspaceId: this.activeWorkspaceId });
    const subscription: SubscriptionLike = {
      closed: false,
      unsubscribe: (): void => {
        subscription.closed = true;
        this.unsubscribeCount += 1;
      },
    };
    this.latestSubscription = subscription;

    return subscription;
  }
}

function contextWith(workspaceId: string, sidebar?: SidebarApi): PluginContext {
  const app = {
    dataset: { activeWorkspaceId: workspaceId },
    piWebSidebar: sidebar,
  } as unknown as AppElement;

  return {
    app,
    backend: async () => ({}),
  };
}

function sidebar(subject: TestSubject): SidebarApi {
  return { state$: subject };
}

const panel = {} as unknown as HTMLElement;

describe("sidebar bridge workspace resolution", (): void => {
  test("uses pi-web-sidebar state$ workspace before dataset fallback", (): void => {
    const state = createFileBrowserState();
    const subject = new TestSubject("sidebar-workspace");
    const context = contextWith("dataset-workspace", sidebar(subject));

    expect(bindSidebarBridge(context, state, panel)).toBe(true);
    expect(activeWorkspaceId(context, state)).toBe("sidebar-workspace");
  });

  test("falls back to dataset when sidebar bridge is absent", (): void => {
    const state = createFileBrowserState();
    const context = contextWith("dataset-workspace");

    expect(bindSidebarBridge(context, state, panel)).toBe(false);
    expect(activeWorkspaceId(context, state)).toBe("dataset-workspace");
  });

  test("connected empty state$ does not fall back to dataset", (): void => {
    const state = createFileBrowserState();
    const subject = new TestSubject("");
    const context = contextWith("dataset-workspace", sidebar(subject));

    expect(bindSidebarBridge(context, state, panel)).toBe(true);
    expect(activeWorkspaceId(context, state)).toBe("");
    expect(subject.subscribeCount).toBe(1);
  });

  test("same state$ preserves last emitted workspace on rebind", (): void => {
    const state = createFileBrowserState();
    const subject = new TestSubject("emitted-workspace");
    const context = contextWith("dataset-workspace", sidebar(subject));

    bindSidebarBridge(context, state, panel);
    expect(bindSidebarBridge(context, state, panel)).toBe(false);

    expect(activeWorkspaceId(context, state)).toBe("emitted-workspace");
    expect(subject.subscribeCount).toBe(1);
  });

  test("new state$ clears previous emitted workspace until it emits", (): void => {
    const state = createFileBrowserState();
    const firstSubject = new TestSubject("first-workspace");
    const secondSubject = new TestSubject("");
    const context = contextWith("dataset-workspace", sidebar(firstSubject));

    bindSidebarBridge(context, state, panel);
    context.app.piWebSidebar = sidebar(secondSubject);

    expect(bindSidebarBridge(context, state, panel)).toBe(true);
    expect(activeWorkspaceId(context, state)).toBe("");
    expect(firstSubject.unsubscribeCount).toBe(1);
  });

  test("replaces an existing sidebar subscription when state$ changes", (): void => {
    const state = createFileBrowserState();
    const firstSubject = new TestSubject("first-workspace");
    const context = contextWith("dataset-workspace", sidebar(firstSubject));

    bindSidebarBridge(context, state, panel);
    context.app.piWebSidebar = sidebar(new TestSubject("second-workspace"));
    expect(bindSidebarBridge(context, state, panel)).toBe(true);

    expect(firstSubject.unsubscribeCount).toBe(1);
    expect(activeWorkspaceId(context, state)).toBe("second-workspace");
  });

  test("keeps the existing subscription when the same state$ is rebound", (): void => {
    const state = createFileBrowserState();
    const subject = new TestSubject("sidebar-workspace");
    const context = contextWith("dataset-workspace", sidebar(subject));

    bindSidebarBridge(context, state, panel);
    expect(bindSidebarBridge(context, state, panel)).toBe(false);

    expect(subject.subscribeCount).toBe(1);
    expect(subject.unsubscribeCount).toBe(0);
  });

  test("resubscribes when the same state$ subscription is closed", (): void => {
    const state = createFileBrowserState();
    const subject = new TestSubject("sidebar-workspace");
    const context = contextWith("dataset-workspace", sidebar(subject));

    bindSidebarBridge(context, state, panel);
    subject.latestSubscription?.unsubscribe();
    expect(bindSidebarBridge(context, state, panel)).toBe(true);

    expect(subject.subscribeCount).toBe(2);
    expect(activeWorkspaceId(context, state)).toBe("sidebar-workspace");
  });
});
