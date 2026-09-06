# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: flaky.test.js >> loads data on button click
- Location: flaky.test.js:3:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "Data Loaded"
Received: ""
```

# Page snapshot

```yaml
- button "Load Data" [active] [ref=e2]
```

# Test source

```ts
  1  | const { test, expect } = require('@playwright/test');
  2  | 
  3  | test('loads data on button click', async ({ page }) => {
  4  |   await page.goto('http://localhost:8080/flaky.html');
  5  |   await page.click('#loadBtn');
  6  |   const text = await page.textContent('#result');
> 7  |   expect(text).toBe('Data Loaded');
     |                ^ Error: expect(received).toBe(expected) // Object.is equality
  8  | });
  9  | 
  10 | 
```