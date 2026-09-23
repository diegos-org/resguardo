// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "../page";

describe("Home", () => {
  it("mostra a identidade SCL", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveProperty("textContent", "Sua Casa Leblon");
  });
});
