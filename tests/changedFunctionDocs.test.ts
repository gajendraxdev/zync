interface FunctionDoc {
  key: string;
  name: string;
  documented: boolean;
  line: number;
}

interface Checker {
  collectFunctions(file: string, source: string): FunctionDoc[];
  changedFunctionDocumentation(file: string, current: string, baseline: string): FunctionDoc[];
}

function equal(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
}

/** Verify installed AST parsers distinguish named implementation docs from adjacent non-doc text. */
export function runChangedFunctionDocsChecks(checker: Checker): void {
  let checks = 0;
  const rust = `//! Module docs are not function docs.
pub fn missing() {}
/// Preserve borrowed input across awaits.
#[cfg(unix)]
pub async fn generic<'a, T: Copy>(input: &'a T) -> &'a T { input }
#[doc = "Literal outer documentation"]
pub unsafe extern "C" fn ffi() {}
impl<T: Copy> Widget<T> {
    /** Return the selected value. */
    pub fn value(&self) -> T { self.value }
    // An ordinary comment is not Rustdoc.
    fn private(&self) {}
}
trait Service {
    fn declaration(&self);
    /// Default behavior is an implementation.
    fn run(&self) {}
}
#[cfg(not(test))]
fn production_only() { let text = "fn not_a_function() {}"; let callback = || 2; }
#[cfg(test)]
mod tests { fn helper() {} #[test] fn test_case() {} }
#[tokio::test]
async fn async_test() {}
`;
  const rustFunctions = checker.collectFunctions('src-tauri/src/example.rs', rust);
  equal(rustFunctions.map(fn => [fn.name, fn.documented]), [
    ['missing', false], ['generic', true], ['ffi', true], ['value', true], ['private', false], ['run', true], ['production_only', false],
  ], 'Rust attributes, generic lifetimes, impl/trait methods and test-only exclusions'); checks++;
  equal(rustFunctions.find(fn => fn.name === 'generic')?.line, 5, 'line numbers identify the actual implementation'); checks++;

  const typescript = `/** Module-adjacent prose does not document the following class member. */
class Widget {
  constructor() {}
  /** Read the current value. */
  get value() { return 1; }
  /** Bound field callback. */
  action = () => 1;
  // Ordinary comments do not qualify.
  method() {}
}
/** Resolve a named function variable. */
const assigned = function () { return 1; };
/** Resolve a named arrow. */
const arrow = <T>(value: T) => value;
const object = {
  /** A documented named property. */
  property: () => true,
};
/** Implementation docs. */
export function implemented(value: number): number;
export function implemented(value: number) { return value; }
[].map(() => 1);
`;
  equal(checker.collectFunctions('src/example.ts', typescript).map(fn => [fn.name, fn.documented]), [
    ['constructor', false], ['value', true], ['action', true], ['method', false], ['assigned', true], ['arrow', true], ['property', true], ['implemented', false],
  ], 'TS named functions, methods, constructors and assigned arrows exclude anonymous callbacks/overloads'); checks++;

  const unchanged = '/// Existing docs.\nfn unchanged() -> u32 { 1 }\nfn changed() -> u32 { 1 }\n';
  const current = unchanged.replace('fn changed() -> u32 { 1 }', '/// Updated result.\nfn changed() -> u32 { 2 }');
  equal(checker.changedFunctionDocumentation('src-tauri/src/example.rs', current, unchanged).map(fn => [fn.name, fn.documented]),
    [['changed', true]], 'only changed implementations enter the denominator'); checks++;
  equal(checker.changedFunctionDocumentation('src-tauri/src/example.rs', unchanged.replaceAll('\n', '\r\n'), unchanged), [],
    'Windows checkout line endings cannot charge unchanged functions'); checks++;

  equal(checker.changedFunctionDocumentation('src/new.ts', '/** New arrow. */\nconst arrow = () => 1;', '').map(fn => [fn.name, fn.documented]),
    [['arrow', true]], 'untracked source compares against an empty baseline'); checks++;
  equal(checker.changedFunctionDocumentation('src/a.ts', 'const x = 2;\nfunction stable() { return 1; }', 'function stable() { return 1; }'), [],
    'non-function changes do not inflate the denominator'); checks++;
  equal(checker.collectFunctions('src-tauri/src/example.rs', '//// Not Rustdoc\nfn a() {}\n/** */\nfn b() {}').map(fn => fn.documented), [false, false],
    'ordinary slash comments and empty blocks do not qualify'); checks++;
  equal(checker.collectFunctions('src/a.ts', '/** */\nconst empty = () => 1;').map(fn => fn.documented), [false], 'empty JSDoc does not qualify'); checks++;
  for (const file of ['tests/example.ts', 'src-tauri/src/performance_tests.rs', 'src-tauri/src/example/tests.rs', 'src/example.test.ts']) {
    equal(checker.collectFunctions(file, file.endsWith('.rs') ? 'fn ignored() {}' : 'function ignored() {}'), [], `${file} is test-only`); checks++;
  }
  const siblings = checker.collectFunctions('src-tauri/src/example.rs', 'impl One { /// First implementation.\nfn same() {} }\nimpl Two { fn same() {} }');
  equal(siblings.map(fn => fn.key), ['impl One::same#0', 'impl Two::same#0'], 'same method names retain independent impl ownership'); checks++;
  const modern = `impl State {
    /// Modern body constructs must not corrupt later function ownership.
    pub async fn first(&self, input: Option<u8>) {
        let Some(value) = input else { return; };
        if let Some(next) = input && next > 0 { let _ = value % next; }
        match input { value @ Some(_) => {}, _ => {} }
    }
    /// Nested generic closers are not bit-shift expressions here.
    pub async fn later<T: Into<Vec<Vec<u8>>>>(&self, input: T) {}
}
/// A top-level function following modern syntax retains its own docs.
async fn after() {}
`;
  equal(checker.collectFunctions('src-tauri/src/modern.rs', modern).map(fn => [fn.key, fn.documented]),
    [['impl State::first#0', true], ['impl State::later#0', true], ['after#0', true]],
    'modern let-else/chains, pattern bindings, modulo and nested generics do not cascade parser recovery'); checks++;
  equal(checker.collectFunctions('src-tauri/src/raw.rs', 'fn real() { let s = r###"fn fake() { } /* not a comment */"###; let pointer: fn() -> u8; }').map(fn => fn.name),
    ['real'], 'raw-string function-like text and function pointer types are not implementations'); checks++;
  equal(checker.collectFunctions('src-tauri/src/macro.rs', 'macro_rules! make { () => { fn generated() {} }; } fn real() { quote! { fn quoted() {} } }').map(fn => fn.name),
    ['real'], 'macro templates and quoted token trees are excluded, not counted as source implementations'); checks++;
  equal(checker.collectFunctions('src-tauri/src/test_module.rs', '#[cfg(test)] pub mod checks { fn helper() {} } fn real() {}').map(fn => fn.name),
    ['real'], 'test-only public modules are excluded across visibility modifiers'); checks++;
  equal(checker.collectFunctions('src-tauri/src/conditional.rs', '#[cfg(all(test, target_os = "linux"))] fn test_helper() {} #[cfg(not(test))] fn production() {}').map(fn => fn.name),
    ['production'], 'compound test-only cfg is excluded while cfg(not(test)) remains production'); checks++;
  equal(checker.collectFunctions('src-tauri/src/conditional.rs', '#[cfg(any(test, unix))] fn can_be_production() {}').map(fn => fn.name),
    ['can_be_production'], 'unknown platform flags are not guessed to be test-only'); checks++;
  let malformed = false;
  try { checker.collectFunctions('src-tauri/src/malformed.rs', 'fn unfinished() {'); } catch { malformed = true; }
  equal(malformed, true, 'unbalanced source fails inspection rather than reporting misleading coverage'); checks++;
  console.log(`Changed-function documentation coverage fixture checks passed (${checks}).`);
}
