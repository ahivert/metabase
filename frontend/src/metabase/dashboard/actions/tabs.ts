import { createAction, createReducer } from "@reduxjs/toolkit";
import type { Draft } from "@reduxjs/toolkit";
import { t } from "ttag";
import { arrayMove } from "@dnd-kit/sortable";

import { normalize } from "normalizr";
import type {
  DashCardId,
  DashboardId,
  DashboardTabId,
  DashboardTab,
  DashboardCard,
} from "metabase-types/api";
import type {
  DashboardState,
  SelectedTabId,
  TabDeletionId,
} from "metabase-types/store";
import { INITIALIZE } from "metabase/dashboard/actions/core";
import { getPositionForNewDashCard } from "metabase/lib/dashboard_grid";

import Dashboards from "metabase/entities/dashboards";
import { DashboardSchema } from "metabase/schema";
import { INITIAL_DASHBOARD_STATE } from "../constants";
import { getExistingDashCards } from "./utils";

type CreateNewTabPayload = { tabId: DashboardTabId };
type DeleteTabPayload = {
  tabId: DashboardTabId | null;
  tabDeletionId: TabDeletionId;
};
type UndoDeleteTabPayload = {
  tabDeletionId: TabDeletionId;
};
type RenameTabPayload = { tabId: DashboardTabId | null; name: string };
type MoveTabPayload = {
  sourceTabId: DashboardTabId;
  destTabId: DashboardTabId;
};
type SelectTabPayload = { tabId: DashboardTabId | null };
type MoveDashCardToTabPayload = {
  dashCardId: DashCardId;
  destTabId: DashboardTabId;
};
type InitTabsPayload = { slug: string | undefined };

const CREATE_NEW_TAB = "metabase/dashboard/CREATE_NEW_TAB";
const DELETE_TAB = "metabase/dashboard/DELETE_TAB";
const UNDO_DELETE_TAB = "metabase/dashboard/UNDO_DELETE_TAB";
const RENAME_TAB = "metabase/dashboard/RENAME_TAB";
const MOVE_TAB = "metabase/dashboard/MOVE_TAB";
const SELECT_TAB = "metabase/dashboard/SELECT_TAB";
const MOVE_DASHCARD_TO_TAB = "metabase/dashboard/MOVE_DASHCARD_TO_TAB";
const INIT_TABS = "metabase/dashboard/INIT_TABS";

const createNewTabAction = createAction<CreateNewTabPayload>(CREATE_NEW_TAB);

let tempTabId = -2;
// Needed for testing
export function resetTempTabId() {
  tempTabId = -2;
}

export function createNewTab() {
  // Decrement by 2 to leave space for two new tabs if dash doesn't have tabs already
  const tabId = tempTabId;
  tempTabId -= 2;

  return createNewTabAction({ tabId });
}

export const selectTab = createAction<SelectTabPayload>(SELECT_TAB);

function _selectTab({
  state,
  tabId,
}: {
  state: Draft<DashboardState>;
  tabId: SelectedTabId;
}) {
  state.selectedTabId = tabId;
}

export const deleteTab = createAction<DeleteTabPayload>(DELETE_TAB);

export const undoDeleteTab =
  createAction<UndoDeleteTabPayload>(UNDO_DELETE_TAB);

export const renameTab = createAction<RenameTabPayload>(RENAME_TAB);

export const moveTab = createAction<MoveTabPayload>(MOVE_TAB);

export const moveDashCardToTab =
  createAction<MoveDashCardToTabPayload>(MOVE_DASHCARD_TO_TAB);

export const initTabs = createAction<InitTabsPayload>(INIT_TABS);

export function getPrevDashAndTabs({
  state,
  filterRemovedTabs = false,
}: {
  state: Draft<DashboardState>;
  filterRemovedTabs?: boolean;
}) {
  const dashId = state.dashboardId;
  const prevDash = dashId ? state.dashboards[dashId] : null;
  const prevTabs =
    prevDash?.tabs?.filter(t => !filterRemovedTabs || !t.isRemoved) ?? [];

  return { dashId, prevDash, prevTabs };
}

export function getDefaultTab({
  tabId,
  dashId,
  name,
}: {
  tabId: DashboardTabId;
  dashId: DashboardId;
  name: string;
}) {
  return {
    id: tabId,
    dashboard_id: dashId,
    name,
    entity_id: "",
    created_at: "",
    updated_at: "",
  };
}

export function getIdFromSlug(slug: string | undefined) {
  if (!slug) {
    return undefined;
  }

  const id = Number(slug.split("-")[0]);
  return Number.isNaN(id) ? undefined : id;
}

export const tabsReducer = createReducer<DashboardState>(
  INITIAL_DASHBOARD_STATE,
  builder => {
    builder.addCase<typeof createNewTabAction>(
      createNewTabAction,
      (state, { payload: { tabId } }) => {
        const { dashId, prevDash, prevTabs } = getPrevDashAndTabs({ state });
        if (!dashId || !prevDash) {
          throw Error(
            `CREATE_NEW_TAB was dispatched but either dashId (${dashId}) or prevDash (${prevDash}) are null`,
          );
        }

        // Case 1: Dashboard already has tabs
        if (prevTabs.length !== 0) {
          // 1. Create new tab, add to dashboard
          const newTab = getDefaultTab({
            tabId,
            dashId,
            name: t`Tab ${prevTabs.filter(t => !t.isRemoved).length + 1}`,
          });
          prevDash.tabs = [...prevTabs, newTab];

          // 2. Select new tab
          state.selectedTabId = tabId;
          return;
        }

        // Case 2: Dashboard doesn't have tabs

        // 1. Create two new tabs, add to dashboard
        const firstTabId = tabId + 1;
        const secondTabId = tabId;
        const newTabs = [
          getDefaultTab({ tabId: firstTabId, dashId, name: t`Tab 1` }),
          getDefaultTab({ tabId: secondTabId, dashId, name: t`Tab 2` }),
        ];
        prevDash.tabs = [...prevTabs, ...newTabs];

        // 2. Select second tab
        state.selectedTabId = secondTabId;

        // 3. Assign existing dashcards to first tab
        prevDash.dashcards.forEach(id => {
          state.dashcards[id] = {
            ...state.dashcards[id],
            isDirty: true,
            dashboard_tab_id: firstTabId,
          };
        });
      },
    );

    builder.addCase(
      deleteTab,
      (state, { payload: { tabId, tabDeletionId } }) => {
        const { prevDash, prevTabs } = getPrevDashAndTabs({
          state,
          filterRemovedTabs: true,
        });
        const tabToRemove = prevTabs.find(({ id }) => id === tabId);
        if (!prevDash || !tabToRemove) {
          throw Error(
            `DELETE_TAB was dispatched but either prevDash (${prevDash}), or tabToRemove (${tabToRemove}) is null/undefined`,
          );
        }

        // 1. Select a different tab if needed
        if (state.selectedTabId === tabToRemove.id) {
          const tabToRemoveIndex = prevTabs.findIndex(
            ({ id }) => id === tabToRemove.id,
          );
          const targetIndex = tabToRemoveIndex === 0 ? 1 : tabToRemoveIndex - 1;
          state.selectedTabId = prevTabs[targetIndex].id;
        }

        // 2. Mark the tab as removed
        tabToRemove.isRemoved = true;

        // 3. Mark dashcards on removed tab as removed
        const removedDashCardIds: DashCardId[] = [];
        prevDash.dashcards.forEach(id => {
          if (state.dashcards[id].dashboard_tab_id === tabToRemove.id) {
            state.dashcards[id].isRemoved = true;
            removedDashCardIds.push(id);
          }
        });

        // 4. Add deletion to history to allow undoing
        state.tabDeletions[tabDeletionId] = {
          id: tabDeletionId,
          tabId: tabToRemove.id,
          removedDashCardIds,
        };
      },
    );

    builder.addCase(undoDeleteTab, (state, { payload: { tabDeletionId } }) => {
      const { prevTabs } = getPrevDashAndTabs({ state });
      const { tabId, removedDashCardIds } = state.tabDeletions[tabDeletionId];
      const removedTab = prevTabs.find(({ id }) => id === tabId);
      if (!removedTab) {
        throw Error(
          `UNDO_DELETE_TAB was dispatched but tab with id ${tabId} was not found`,
        );
      }

      // 1. Unmark tab as removed
      removedTab.isRemoved = false;

      // 2. Unmark dashcards as removed
      removedDashCardIds.forEach(id => (state.dashcards[id].isRemoved = false));

      // 3. Remove deletion from history
      delete state.tabDeletions[tabDeletionId];
    });

    builder.addCase(renameTab, (state, { payload: { tabId, name } }) => {
      const { prevTabs } = getPrevDashAndTabs({ state });
      const tabToRenameIndex = prevTabs.findIndex(({ id }) => id === tabId);

      if (tabToRenameIndex === -1) {
        throw Error(
          `RENAME_TAB was dispatched but tabToRenameIndex (${tabToRenameIndex}) is invalid`,
        );
      }

      prevTabs[tabToRenameIndex].name = name;
    });

    builder.addCase(
      moveTab,
      (state, { payload: { sourceTabId, destTabId } }) => {
        const { prevDash, prevTabs } = getPrevDashAndTabs({ state });
        const sourceTabIndex = prevTabs.findIndex(
          ({ id }) => id === sourceTabId,
        );
        const destTabIndex = prevTabs.findIndex(({ id }) => id === destTabId);

        if (!prevDash || sourceTabIndex === -1 || destTabIndex === -1) {
          throw Error(
            `MOVE_TAB was dispatched but either prevDash (${JSON.stringify(
              prevDash,
            )}), sourceTabIndex (${sourceTabIndex}) or destTabIndex (${destTabIndex}) is invalid`,
          );
        }

        prevDash.tabs = arrayMove(prevTabs, sourceTabIndex, destTabIndex);
      },
    );

    builder.addCase(selectTab, (state, { payload: { tabId } }) => {
      _selectTab({ state, tabId });
    });

    builder.addCase(
      moveDashCardToTab,
      (state, { payload: { dashCardId, destTabId } }) => {
        const { dashId } = getPrevDashAndTabs({ state });
        if (dashId === null) {
          throw Error(
            `MOVE_DASHCARD_TO_TAB was dispatched but dashId (${dashId}) is null`,
          );
        }
        const dashCard = state.dashcards[dashCardId];

        const { row, col } = getPositionForNewDashCard(
          getExistingDashCards(state, dashId, destTabId),
          dashCard.size_x,
          dashCard.size_y,
        );
        dashCard.row = row;
        dashCard.col = col;

        dashCard.dashboard_tab_id = destTabId;
        dashCard.isDirty = true;
      },
    );

    builder.addCase(Dashboards.actionTypes.UPDATE, (state, { payload }) => {
      const { dashboard } = payload;
      const entities = normalize(dashboard, DashboardSchema).entities;
      const newDashcards = entities.dashcards as DashboardCard[];
      const newTabs = entities.tabs as DashboardTab[];

      const { prevDash, prevTabs } = getPrevDashAndTabs({
        state,
        filterRemovedTabs: true,
      });
      if (!prevDash) {
        throw Error(
          `Dashboards.actionTypes.UPDATE was dispatched but prevDash (${prevDash}) is null`,
        );
      }

      // 1. Replace temporary with real dashcard ids
      const prevCards = prevDash.dashcards.filter(
        id => !state.dashcards[id].isRemoved,
      );

      prevCards.forEach((oldId, index) => {
        const prevDashcardData = state.dashcardData[oldId];

        if (prevDashcardData) {
          state.dashcardData[newDashcards[index].id] = prevDashcardData;
        }
      });

      // 2. Re-select the currently selected tab with its real id
      const selectedTabIndex = prevTabs.findIndex(
        tab => tab.id === state.selectedTabId,
      );
      state.selectedTabId = (newTabs && newTabs[selectedTabIndex]?.id) ?? null;
    });

    builder.addCase<
      string,
      { type: string; payload?: { clearCache: boolean } }
    >(INITIALIZE, (state, { payload: { clearCache = true } = {} }) => {
      if (clearCache) {
        state.selectedTabId = INITIAL_DASHBOARD_STATE.selectedTabId;
        state.tabDeletions = INITIAL_DASHBOARD_STATE.tabDeletions;
      }
    });

    builder.addCase(initTabs, (state, { payload: { slug } }) => {
      const { prevTabs } = getPrevDashAndTabs({ state });

      const idFromSlug = getIdFromSlug(slug);
      const tabId =
        idFromSlug && prevTabs.map(t => t.id).includes(idFromSlug)
          ? idFromSlug
          : prevTabs[0]?.id ?? null;

      state.selectedTabId = tabId;
    });
  },
);
