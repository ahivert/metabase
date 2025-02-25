import { useCallback, useMemo } from "react";
import { t } from "ttag";
import type {
  DatasetColumn,
  TableColumnOrderSetting,
} from "metabase-types/api";
import { Text } from "metabase/ui";
import { TableColumnSelector } from "./TableColumnSelector";
import {
  disableColumnInSettings,
  enableColumnInSettings,
  getColumnSettingsWithRefs,
  getDatasetColumnSettingItems,
  moveColumnInSettings,
} from "./utils";
import type {
  ColumnSettingItem,
  DragColumnProps,
  EditWidgetConfig,
} from "./types";

export interface DatasetColumnSelectorProps {
  value: TableColumnOrderSetting[];
  columns: DatasetColumn[];
  getColumnName: (column: DatasetColumn) => string;
  onChange: (value: TableColumnOrderSetting[]) => void;
  onShowWidget: (config: EditWidgetConfig, targetElement: HTMLElement) => void;
}

export const DatasetColumnSelector = ({
  value,
  columns: datasetColumns,
  getColumnName,
  onChange,
  onShowWidget,
}: DatasetColumnSelectorProps) => {
  const columnSettings = useMemo(() => {
    return getColumnSettingsWithRefs(value);
  }, [value]);

  const columnItems = useMemo(() => {
    return getDatasetColumnSettingItems(datasetColumns, columnSettings);
  }, [datasetColumns, columnSettings]);

  const handleEnableColumn = useCallback(
    (columnItem: ColumnSettingItem) => {
      onChange(enableColumnInSettings(columnSettings, columnItem));
    },
    [columnSettings, onChange],
  );

  const handleDisableColumn = useCallback(
    (columnItem: ColumnSettingItem) => {
      onChange(disableColumnInSettings(columnSettings, columnItem));
    },
    [columnSettings, onChange],
  );

  const handleDragColumn = useCallback(
    (props: DragColumnProps) => {
      onChange(moveColumnInSettings(columnSettings, columnItems, props));
    },
    [columnSettings, columnItems, onChange],
  );

  return (
    <>
      <Text
        component="label"
        display="block"
        fw={700}
        mb="0.5rem"
        fs="0.875em"
      >{t`Columns`}</Text>
      <TableColumnSelector
        columnItems={columnItems}
        getColumnName={({ datasetColumn }) => getColumnName(datasetColumn)}
        onEnableColumn={handleEnableColumn}
        onDisableColumn={handleDisableColumn}
        onDragColumn={handleDragColumn}
        onShowWidget={onShowWidget}
      />
    </>
  );
};
