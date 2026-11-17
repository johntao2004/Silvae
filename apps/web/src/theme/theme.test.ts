// 验证阅读主题映射到整站语义 token，避免颜色模式只影响阅读正文。
// Checks reader themes map to whole-site semantic tokens rather than only reading content.
import { tokens } from "./tokens";
import { createHumiteTheme } from "./theme";

describe("createHumiteTheme", () => {
  it("maps the reader's three visual themes onto the whole-site palette", () => {
    const paper = createHumiteTheme("PAPER");
    const white = createHumiteTheme("WHITE");
    const night = createHumiteTheme("NIGHT");

    expect(paper.palette.background.default).toBe(tokens.color.semantic.canvas);
    expect(white.palette.background.default).toBe(tokens.color.primitive.white);
    expect(night.palette.mode).toBe("dark");
    expect(night.palette.background.default).toBe(tokens.color.semantic.surfaceDark);
    expect(night.palette.background.paper).toBe(tokens.color.semantic.surfaceDarkRaised);
    expect(night.palette.text.primary).toBe(tokens.color.semantic.textOnDark);
  });
});
