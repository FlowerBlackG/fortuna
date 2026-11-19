// SPDX-License-Identifier: MulanPSL-2.0
import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import type { EChartsCoreOption } from "echarts/core";
import { LineChart, PieChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
  DataZoomComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  LineChart,
  PieChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

export function Chart({ option, label }: { option: EChartsCoreOption; label: string }) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const chart = echarts.init(element.current!);
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const container = element.current;
        if (
          container &&
          (chart.getWidth() !== container.clientWidth ||
            chart.getHeight() !== container.clientHeight)
        )
          chart.resize();
      });
    });
    observer.observe(element.current!);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      chart.dispose();
    };
  }, []);
  useEffect(() => {
    if (element.current) echarts.getInstanceByDom(element.current)?.setOption(option, true);
  }, [option]);
  return <div className="chart" ref={element} role="img" aria-label={label} />;
}
