// Generates copy-ready Appium client snippets for a given (language, strategy, value)
// triple. Used by the Selector Health "Suggested rewrite" copy chevron.
//
// The library coverage is intentionally Appium client–oriented: WebdriverIO (JS),
// Appium-Java (AppiumBy), Appium-Python (AppiumBy enums), .NET (MobileBy / By),
// and Ruby. Strategies covered are the ones the healer actually emits today
// (see HealingResult.recommendedStrategy in src/services/healing/...).

export type Language = 'javascript' | 'java' | 'python' | 'csharp' | 'ruby';

type SnippetTemplate = (escapedValue: string) => string;

const SNIPPETS: Record<Language, Record<string, SnippetTemplate>> = {
  javascript: {
    'accessibility id': (v) => `await driver.findElement('accessibility id', '${v}')`,
    xpath: (v) => `await driver.findElement('xpath', '${v}')`,
    id: (v) => `await driver.findElement('id', '${v}')`,
    name: (v) => `await driver.findElement('name', '${v}')`,
    'class name': (v) => `await driver.findElement('class name', '${v}')`,
    '-android uiautomator': (v) => `await driver.findElement('-android uiautomator', '${v}')`,
    '-ios predicate string': (v) => `await driver.findElement('-ios predicate string', '${v}')`,
    '-ios class chain': (v) => `await driver.findElement('-ios class chain', '${v}')`,
  },
  java: {
    'accessibility id': (v) => `driver.findElement(AppiumBy.accessibilityId("${v}"))`,
    xpath: (v) => `driver.findElement(AppiumBy.xpath("${v}"))`,
    id: (v) => `driver.findElement(AppiumBy.id("${v}"))`,
    name: (v) => `driver.findElement(AppiumBy.name("${v}"))`,
    'class name': (v) => `driver.findElement(AppiumBy.className("${v}"))`,
    '-android uiautomator': (v) => `driver.findElement(AppiumBy.androidUIAutomator("${v}"))`,
    '-ios predicate string': (v) => `driver.findElement(AppiumBy.iOSNsPredicateString("${v}"))`,
    '-ios class chain': (v) => `driver.findElement(AppiumBy.iOSClassChain("${v}"))`,
  },
  python: {
    'accessibility id': (v) => `driver.find_element(AppiumBy.ACCESSIBILITY_ID, '${v}')`,
    xpath: (v) => `driver.find_element(AppiumBy.XPATH, '${v}')`,
    id: (v) => `driver.find_element(AppiumBy.ID, '${v}')`,
    name: (v) => `driver.find_element(AppiumBy.NAME, '${v}')`,
    'class name': (v) => `driver.find_element(AppiumBy.CLASS_NAME, '${v}')`,
    '-android uiautomator': (v) => `driver.find_element(AppiumBy.ANDROID_UIAUTOMATOR, '${v}')`,
    '-ios predicate string': (v) => `driver.find_element(AppiumBy.IOS_PREDICATE, '${v}')`,
    '-ios class chain': (v) => `driver.find_element(AppiumBy.IOS_CLASS_CHAIN, '${v}')`,
  },
  csharp: {
    'accessibility id': (v) => `driver.FindElement(MobileBy.AccessibilityId("${v}"))`,
    xpath: (v) => `driver.FindElement(By.XPath("${v}"))`,
    id: (v) => `driver.FindElement(By.Id("${v}"))`,
    name: (v) => `driver.FindElement(By.Name("${v}"))`,
    'class name': (v) => `driver.FindElement(By.ClassName("${v}"))`,
  },
  ruby: {
    'accessibility id': (v) => `driver.find_element(:accessibility_id, '${v}')`,
    xpath: (v) => `driver.find_element(:xpath, '${v}')`,
    id: (v) => `driver.find_element(:id, '${v}')`,
    name: (v) => `driver.find_element(:name, '${v}')`,
    'class name': (v) => `driver.find_element(:class_name, '${v}')`,
  },
};

// Java and C# snippets quote with `"`; everything else with `'`. Backslashes
// are escaped for both.
function escapeForLanguage(lang: Language, value: string): string {
  const usesDoubleQuotes = lang === 'java' || lang === 'csharp';
  const escapedSlashes = value.replace(/\\/g, '\\\\');
  if (usesDoubleQuotes) {
    return escapedSlashes.replace(/"/g, '\\"');
  }
  return escapedSlashes.replace(/'/g, "\\'");
}

export function snippet(lang: Language, strategy: string, value: string): string {
  if (strategy === 'xenon:visual') {
    return '/* Visual AI (coordinates) — no portable Appium snippet. Use snapshot view to find a stable native locator. */';
  }
  const tmpl = SNIPPETS[lang]?.[strategy];
  if (!tmpl) {
    const label = (strategy ?? '').toString().toUpperCase();
    return `${label}: ${value}`;
  }
  return tmpl(escapeForLanguage(lang, value));
}
