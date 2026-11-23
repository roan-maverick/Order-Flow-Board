# Prompts for reading the board with AI

Two ways to give an AI the board:

- **Copy for AI** (button on the board): copies a text brief. Paste it into any AI chat first, then ask.
- **Claude with the MCP connection** (see the README): just ask. Claude reads the live board itself.

The answers are only as good as the readings, and readings are not advice. Use them to understand the market, not as orders.

## Understand the day

- What is the market doing right now? Summarise breadth, the leading and lagging sectors, and how the benchmark compares.
- Is today's move broad (most names joining) or narrow (a few big names carrying it)? Use the up/flat/down counts per sector.
- Explain this board to me like I'm new to trading, in five short points.
- What changed between the day window and the last hour? (Read both windows.)

## Find setups

- Find bullish stocks bought on heavy volume with at least 4 of 5 checks. For each, how far is support?
- Which names have all five checks holding? Group them by sector.
- List bearish names with fresh selling whose resistance is within 2%.
- Which crypto perps show long build-up on the 4h window and short build-up on the 24h? (Read both windows.)
- Which sector has the most names with heavy buying but the smallest median move? (Possible early strength.)

## Go deeper on one name

- Give me the full reading on NVDA. Which checks fail, and what would need to change for them to pass?
- Compare AAPL and MSFT on today's board: build-up, relative volume, put/call walls, distance to levels.
- Where are SPY's put wall and call wall, and where is the price between them?

## Build and review a strategy

- Here is my paper-trades.csv. What did the losing trades have in common (sector, build-up, number of checks, time of day, distance to stop)?
- Suggest three simple, testable rule changes for the paper bot based on these trades. Explain the reasoning, not just the numbers.
- Write the rules of this strategy as plain-English steps a beginner could follow, with the exact board fields each step uses.

## Tips

- Name the window and the list ("US, day window, S&P 500") so the AI reads the same board you see.
- Ask for reasons tied to the board's fields (build-up, checks, levels), not predictions.
- When the US market is closed, the board shows the last session. Say so if you ask about "today".
