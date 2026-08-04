"""程式碼區塊解析（T054）。

SC-004 要求套用後逐字一致，因此解析 MUST NOT 做 trim 以外的任何處理。
"""

from __future__ import annotations

from techinterview.ai.code_blocks import extract_code_blocks


class TestExtraction:
    def test_no_blocks(self):
        assert extract_code_blocks("純文字說明，沒有程式碼。") == []

    def test_single_block(self):
        blocks = extract_code_blocks("說明\n\n```python\nprint(1)\n```\n")
        assert len(blocks) == 1
        assert blocks[0].block_index == 0
        assert blocks[0].language == "python"
        assert blocks[0].content == "print(1)\n"

    def test_multiple_blocks_indexed_in_order(self):
        text = "```js\na\n```\n\n中間文字\n\n```py\nb\n```\n"
        blocks = extract_code_blocks(text)
        assert [b.block_index for b in blocks] == [0, 1]
        assert [b.language for b in blocks] == ["js", "py"]

    def test_block_without_language(self):
        blocks = extract_code_blocks("```\nplain\n```\n")
        assert blocks[0].language is None

    def test_unterminated_block_is_kept(self):
        """串流中斷或模型忘了收尾時，那段內容仍是可套用的產出。"""
        blocks = extract_code_blocks("```javascript\nconst a = 1;\nconst b = 2;")
        assert len(blocks) == 1
        assert "const b = 2;" in blocks[0].content

    def test_empty_block_dropped(self):
        assert extract_code_blocks("```js\n\n```\n") == []


class TestVerbatimPreservation:
    def test_indentation_preserved(self):
        code = "def f():\n    if True:\n        return 1\n"
        blocks = extract_code_blocks(f"```python\n{code}```")
        assert blocks[0].content == code

    def test_blank_lines_preserved(self):
        code = "a = 1\n\n\nb = 2\n"
        blocks = extract_code_blocks(f"```python\n{code}```")
        assert blocks[0].content == code

    def test_trailing_whitespace_preserved(self):
        code = "x = 1   \ny = 2\n"
        blocks = extract_code_blocks(f"```python\n{code}```")
        assert blocks[0].content == code

    def test_tabs_preserved(self):
        code = "func main() {\n\tprintln(1)\n}\n"
        blocks = extract_code_blocks(f"```go\n{code}```")
        assert blocks[0].content == code

    def test_missing_trailing_newline_is_added(self):
        blocks = extract_code_blocks("```js\nconst a = 1;\n```")
        assert blocks[0].content.endswith("\n")


class TestNotAFilter:
    """解析不是輸出過濾層——長度、內容都不影響是否被取出（憲章原則 I）。"""

    def test_very_long_complete_implementation_extracted(self):
        code = "class Big {\n" + "".join(f"  m{i}() {{ return {i}; }}\n" for i in range(50)) + "}\n"
        blocks = extract_code_blocks(f"```javascript\n{code}```")
        assert blocks[0].content == code

    def test_content_is_never_altered_regardless_of_shape(self):
        code = "// TODO: 這看起來像完整解答\nfunction solve() { return 42; }\n"
        blocks = extract_code_blocks(f"```javascript\n{code}```")
        assert blocks[0].content == code
