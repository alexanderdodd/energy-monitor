import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChartBoundary } from "../web/src/components/ChartBoundary.tsx";

function Exploding(): never {
  throw new Error("canvas not available");
}

describe("ChartBoundary", () => {
  it("contains a failing chart instead of blanking the page", () => {
    // React logs the caught error; that is expected here.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <div>
        <p>Today 4.12 kWh</p>
        <ChartBoundary>
          <Exploding />
        </ChartBoundary>
      </div>,
    );

    expect(screen.getByText("This chart could not be displayed.")).toBeInTheDocument();
    // The numbers around it must survive - losing the dashboard because a
    // canvas would not initialise is far worse than losing one chart.
    expect(screen.getByText("Today 4.12 kWh")).toBeInTheDocument();

    consoleError.mockRestore();
  });

  it("renders its child when nothing goes wrong", () => {
    render(
      <ChartBoundary>
        <p>a chart</p>
      </ChartBoundary>,
    );
    expect(screen.getByText("a chart")).toBeInTheDocument();
  });
});
