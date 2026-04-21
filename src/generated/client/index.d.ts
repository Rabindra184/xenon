
/**
 * Client
**/

import * as runtime from './runtime/library.js';
import $Types = runtime.Types // general types
import $Public = runtime.Types.Public
import $Utils = runtime.Types.Utils
import $Extensions = runtime.Types.Extensions
import $Result = runtime.Types.Result

export type PrismaPromise<T> = $Public.PrismaPromise<T>


/**
 * Model Build
 * 
 */
export type Build = $Result.DefaultSelection<Prisma.$BuildPayload>
/**
 * Model Session
 * 
 */
export type Session = $Result.DefaultSelection<Prisma.$SessionPayload>
/**
 * Model SessionLog
 * 
 */
export type SessionLog = $Result.DefaultSelection<Prisma.$SessionLogPayload>
/**
 * Model Log
 * 
 */
export type Log = $Result.DefaultSelection<Prisma.$LogPayload>
/**
 * Model Profiling
 * 
 */
export type Profiling = $Result.DefaultSelection<Prisma.$ProfilingPayload>
/**
 * Model App
 * 
 */
export type App = $Result.DefaultSelection<Prisma.$AppPayload>
/**
 * Model Device
 * 
 */
export type Device = $Result.DefaultSelection<Prisma.$DevicePayload>
/**
 * Model PendingSession
 * 
 */
export type PendingSession = $Result.DefaultSelection<Prisma.$PendingSessionPayload>
/**
 * Model CLIArgs
 * 
 */
export type CLIArgs = $Result.DefaultSelection<Prisma.$CLIArgsPayload>
/**
 * Model WebhookConfig
 * 
 */
export type WebhookConfig = $Result.DefaultSelection<Prisma.$WebhookConfigPayload>
/**
 * Model WebConfig
 * 
 */
export type WebConfig = $Result.DefaultSelection<Prisma.$WebConfigPayload>
/**
 * Model LocatorEtalon
 * 
 */
export type LocatorEtalon = $Result.DefaultSelection<Prisma.$LocatorEtalonPayload>

/**
 * ##  Prisma Client ʲˢ
 * 
 * Type-safe database client for TypeScript & Node.js
 * @example
 * ```
 * const prisma = new PrismaClient()
 * // Fetch zero or more Builds
 * const builds = await prisma.build.findMany()
 * ```
 *
 * 
 * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client).
 */
export class PrismaClient<
  ClientOptions extends Prisma.PrismaClientOptions = Prisma.PrismaClientOptions,
  U = 'log' extends keyof ClientOptions ? ClientOptions['log'] extends Array<Prisma.LogLevel | Prisma.LogDefinition> ? Prisma.GetEvents<ClientOptions['log']> : never : never,
  ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs
> {
  [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['other'] }

    /**
   * ##  Prisma Client ʲˢ
   * 
   * Type-safe database client for TypeScript & Node.js
   * @example
   * ```
   * const prisma = new PrismaClient()
   * // Fetch zero or more Builds
   * const builds = await prisma.build.findMany()
   * ```
   *
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client).
   */

  constructor(optionsArg ?: Prisma.Subset<ClientOptions, Prisma.PrismaClientOptions>);
  $on<V extends U>(eventType: V, callback: (event: V extends 'query' ? Prisma.QueryEvent : Prisma.LogEvent) => void): void;

  /**
   * Connect with the database
   */
  $connect(): $Utils.JsPromise<void>;

  /**
   * Disconnect from the database
   */
  $disconnect(): $Utils.JsPromise<void>;

  /**
   * Add a middleware
   * @deprecated since 4.16.0. For new code, prefer client extensions instead.
   * @see https://pris.ly/d/extensions
   */
  $use(cb: Prisma.Middleware): void

/**
   * Executes a prepared raw query and returns the number of affected rows.
   * @example
   * ```
   * const result = await prisma.$executeRaw`UPDATE User SET cool = ${true} WHERE email = ${'user@email.com'};`
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $executeRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<number>;

  /**
   * Executes a raw query and returns the number of affected rows.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$executeRawUnsafe('UPDATE User SET cool = $1 WHERE email = $2 ;', true, 'user@email.com')
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $executeRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<number>;

  /**
   * Performs a prepared raw query and returns the `SELECT` data.
   * @example
   * ```
   * const result = await prisma.$queryRaw`SELECT * FROM User WHERE id = ${1} OR email = ${'user@email.com'};`
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $queryRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<T>;

  /**
   * Performs a raw query and returns the `SELECT` data.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$queryRawUnsafe('SELECT * FROM User WHERE id = $1 OR email = $2;', 1, 'user@email.com')
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $queryRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<T>;


  /**
   * Allows the running of a sequence of read/write operations that are guaranteed to either succeed or fail as a whole.
   * @example
   * ```
   * const [george, bob, alice] = await prisma.$transaction([
   *   prisma.user.create({ data: { name: 'George' } }),
   *   prisma.user.create({ data: { name: 'Bob' } }),
   *   prisma.user.create({ data: { name: 'Alice' } }),
   * ])
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/concepts/components/prisma-client/transactions).
   */
  $transaction<P extends Prisma.PrismaPromise<any>[]>(arg: [...P], options?: { isolationLevel?: Prisma.TransactionIsolationLevel }): $Utils.JsPromise<runtime.Types.Utils.UnwrapTuple<P>>

  $transaction<R>(fn: (prisma: Omit<PrismaClient, runtime.ITXClientDenyList>) => $Utils.JsPromise<R>, options?: { maxWait?: number, timeout?: number, isolationLevel?: Prisma.TransactionIsolationLevel }): $Utils.JsPromise<R>


  $extends: $Extensions.ExtendsHook<"extends", Prisma.TypeMapCb, ExtArgs>

      /**
   * `prisma.build`: Exposes CRUD operations for the **Build** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Builds
    * const builds = await prisma.build.findMany()
    * ```
    */
  get build(): Prisma.BuildDelegate<ExtArgs>;

  /**
   * `prisma.session`: Exposes CRUD operations for the **Session** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Sessions
    * const sessions = await prisma.session.findMany()
    * ```
    */
  get session(): Prisma.SessionDelegate<ExtArgs>;

  /**
   * `prisma.sessionLog`: Exposes CRUD operations for the **SessionLog** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more SessionLogs
    * const sessionLogs = await prisma.sessionLog.findMany()
    * ```
    */
  get sessionLog(): Prisma.SessionLogDelegate<ExtArgs>;

  /**
   * `prisma.log`: Exposes CRUD operations for the **Log** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Logs
    * const logs = await prisma.log.findMany()
    * ```
    */
  get log(): Prisma.LogDelegate<ExtArgs>;

  /**
   * `prisma.profiling`: Exposes CRUD operations for the **Profiling** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Profilings
    * const profilings = await prisma.profiling.findMany()
    * ```
    */
  get profiling(): Prisma.ProfilingDelegate<ExtArgs>;

  /**
   * `prisma.app`: Exposes CRUD operations for the **App** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Apps
    * const apps = await prisma.app.findMany()
    * ```
    */
  get app(): Prisma.AppDelegate<ExtArgs>;

  /**
   * `prisma.device`: Exposes CRUD operations for the **Device** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Devices
    * const devices = await prisma.device.findMany()
    * ```
    */
  get device(): Prisma.DeviceDelegate<ExtArgs>;

  /**
   * `prisma.pendingSession`: Exposes CRUD operations for the **PendingSession** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more PendingSessions
    * const pendingSessions = await prisma.pendingSession.findMany()
    * ```
    */
  get pendingSession(): Prisma.PendingSessionDelegate<ExtArgs>;

  /**
   * `prisma.cLIArgs`: Exposes CRUD operations for the **CLIArgs** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more CLIArgs
    * const cLIArgs = await prisma.cLIArgs.findMany()
    * ```
    */
  get cLIArgs(): Prisma.CLIArgsDelegate<ExtArgs>;

  /**
   * `prisma.webhookConfig`: Exposes CRUD operations for the **WebhookConfig** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more WebhookConfigs
    * const webhookConfigs = await prisma.webhookConfig.findMany()
    * ```
    */
  get webhookConfig(): Prisma.WebhookConfigDelegate<ExtArgs>;

  /**
   * `prisma.webConfig`: Exposes CRUD operations for the **WebConfig** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more WebConfigs
    * const webConfigs = await prisma.webConfig.findMany()
    * ```
    */
  get webConfig(): Prisma.WebConfigDelegate<ExtArgs>;

  /**
   * `prisma.locatorEtalon`: Exposes CRUD operations for the **LocatorEtalon** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more LocatorEtalons
    * const locatorEtalons = await prisma.locatorEtalon.findMany()
    * ```
    */
  get locatorEtalon(): Prisma.LocatorEtalonDelegate<ExtArgs>;
}

export namespace Prisma {
  export import DMMF = runtime.DMMF

  export type PrismaPromise<T> = $Public.PrismaPromise<T>

  /**
   * Validator
   */
  export import validator = runtime.Public.validator

  /**
   * Prisma Errors
   */
  export import PrismaClientKnownRequestError = runtime.PrismaClientKnownRequestError
  export import PrismaClientUnknownRequestError = runtime.PrismaClientUnknownRequestError
  export import PrismaClientRustPanicError = runtime.PrismaClientRustPanicError
  export import PrismaClientInitializationError = runtime.PrismaClientInitializationError
  export import PrismaClientValidationError = runtime.PrismaClientValidationError
  export import NotFoundError = runtime.NotFoundError

  /**
   * Re-export of sql-template-tag
   */
  export import sql = runtime.sqltag
  export import empty = runtime.empty
  export import join = runtime.join
  export import raw = runtime.raw
  export import Sql = runtime.Sql



  /**
   * Decimal.js
   */
  export import Decimal = runtime.Decimal

  export type DecimalJsLike = runtime.DecimalJsLike

  /**
   * Metrics 
   */
  export type Metrics = runtime.Metrics
  export type Metric<T> = runtime.Metric<T>
  export type MetricHistogram = runtime.MetricHistogram
  export type MetricHistogramBucket = runtime.MetricHistogramBucket

  /**
  * Extensions
  */
  export import Extension = $Extensions.UserArgs
  export import getExtensionContext = runtime.Extensions.getExtensionContext
  export import Args = $Public.Args
  export import Payload = $Public.Payload
  export import Result = $Public.Result
  export import Exact = $Public.Exact

  /**
   * Prisma Client JS version: 5.22.0
   * Query Engine version: 605197351a3c8bdd595af2d2a9bc3025bca48ea2
   */
  export type PrismaVersion = {
    client: string
  }

  export const prismaVersion: PrismaVersion 

  /**
   * Utility Types
   */


  export import JsonObject = runtime.JsonObject
  export import JsonArray = runtime.JsonArray
  export import JsonValue = runtime.JsonValue
  export import InputJsonObject = runtime.InputJsonObject
  export import InputJsonArray = runtime.InputJsonArray
  export import InputJsonValue = runtime.InputJsonValue

  /**
   * Types of the values used to represent different kinds of `null` values when working with JSON fields.
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  namespace NullTypes {
    /**
    * Type of `Prisma.DbNull`.
    * 
    * You cannot use other instances of this class. Please use the `Prisma.DbNull` value.
    * 
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class DbNull {
      private DbNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.JsonNull`.
    * 
    * You cannot use other instances of this class. Please use the `Prisma.JsonNull` value.
    * 
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class JsonNull {
      private JsonNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.AnyNull`.
    * 
    * You cannot use other instances of this class. Please use the `Prisma.AnyNull` value.
    * 
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class AnyNull {
      private AnyNull: never
      private constructor()
    }
  }

  /**
   * Helper for filtering JSON entries that have `null` on the database (empty on the db)
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const DbNull: NullTypes.DbNull

  /**
   * Helper for filtering JSON entries that have JSON `null` values (not empty on the db)
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const JsonNull: NullTypes.JsonNull

  /**
   * Helper for filtering JSON entries that are `Prisma.DbNull` or `Prisma.JsonNull`
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const AnyNull: NullTypes.AnyNull

  type SelectAndInclude = {
    select: any
    include: any
  }

  type SelectAndOmit = {
    select: any
    omit: any
  }

  /**
   * Get the type of the value, that the Promise holds.
   */
  export type PromiseType<T extends PromiseLike<any>> = T extends PromiseLike<infer U> ? U : T;

  /**
   * Get the return type of a function which returns a Promise.
   */
  export type PromiseReturnType<T extends (...args: any) => $Utils.JsPromise<any>> = PromiseType<ReturnType<T>>

  /**
   * From T, pick a set of properties whose keys are in the union K
   */
  type Prisma__Pick<T, K extends keyof T> = {
      [P in K]: T[P];
  };


  export type Enumerable<T> = T | Array<T>;

  export type RequiredKeys<T> = {
    [K in keyof T]-?: {} extends Prisma__Pick<T, K> ? never : K
  }[keyof T]

  export type TruthyKeys<T> = keyof {
    [K in keyof T as T[K] extends false | undefined | null ? never : K]: K
  }

  export type TrueKeys<T> = TruthyKeys<Prisma__Pick<T, RequiredKeys<T>>>

  /**
   * Subset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection
   */
  export type Subset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never;
  };

  /**
   * SelectSubset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection.
   * Additionally, it validates, if both select and include are present. If the case, it errors.
   */
  export type SelectSubset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    (T extends SelectAndInclude
      ? 'Please either choose `select` or `include`.'
      : T extends SelectAndOmit
        ? 'Please either choose `select` or `omit`.'
        : {})

  /**
   * Subset + Intersection
   * @desc From `T` pick properties that exist in `U` and intersect `K`
   */
  export type SubsetIntersection<T, U, K> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    K

  type Without<T, U> = { [P in Exclude<keyof T, keyof U>]?: never };

  /**
   * XOR is needed to have a real mutually exclusive union type
   * https://stackoverflow.com/questions/42123407/does-typescript-support-mutually-exclusive-types
   */
  type XOR<T, U> =
    T extends object ?
    U extends object ?
      (Without<T, U> & U) | (Without<U, T> & T)
    : U : T


  /**
   * Is T a Record?
   */
  type IsObject<T extends any> = T extends Array<any>
  ? False
  : T extends Date
  ? False
  : T extends Uint8Array
  ? False
  : T extends BigInt
  ? False
  : T extends object
  ? True
  : False


  /**
   * If it's T[], return T
   */
  export type UnEnumerate<T extends unknown> = T extends Array<infer U> ? U : T

  /**
   * From ts-toolbelt
   */

  type __Either<O extends object, K extends Key> = Omit<O, K> &
    {
      // Merge all but K
      [P in K]: Prisma__Pick<O, P & keyof O> // With K possibilities
    }[K]

  type EitherStrict<O extends object, K extends Key> = Strict<__Either<O, K>>

  type EitherLoose<O extends object, K extends Key> = ComputeRaw<__Either<O, K>>

  type _Either<
    O extends object,
    K extends Key,
    strict extends Boolean
  > = {
    1: EitherStrict<O, K>
    0: EitherLoose<O, K>
  }[strict]

  type Either<
    O extends object,
    K extends Key,
    strict extends Boolean = 1
  > = O extends unknown ? _Either<O, K, strict> : never

  export type Union = any

  type PatchUndefined<O extends object, O1 extends object> = {
    [K in keyof O]: O[K] extends undefined ? At<O1, K> : O[K]
  } & {}

  /** Helper Types for "Merge" **/
  export type IntersectOf<U extends Union> = (
    U extends unknown ? (k: U) => void : never
  ) extends (k: infer I) => void
    ? I
    : never

  export type Overwrite<O extends object, O1 extends object> = {
      [K in keyof O]: K extends keyof O1 ? O1[K] : O[K];
  } & {};

  type _Merge<U extends object> = IntersectOf<Overwrite<U, {
      [K in keyof U]-?: At<U, K>;
  }>>;

  type Key = string | number | symbol;
  type AtBasic<O extends object, K extends Key> = K extends keyof O ? O[K] : never;
  type AtStrict<O extends object, K extends Key> = O[K & keyof O];
  type AtLoose<O extends object, K extends Key> = O extends unknown ? AtStrict<O, K> : never;
  export type At<O extends object, K extends Key, strict extends Boolean = 1> = {
      1: AtStrict<O, K>;
      0: AtLoose<O, K>;
  }[strict];

  export type ComputeRaw<A extends any> = A extends Function ? A : {
    [K in keyof A]: A[K];
  } & {};

  export type OptionalFlat<O> = {
    [K in keyof O]?: O[K];
  } & {};

  type _Record<K extends keyof any, T> = {
    [P in K]: T;
  };

  // cause typescript not to expand types and preserve names
  type NoExpand<T> = T extends unknown ? T : never;

  // this type assumes the passed object is entirely optional
  type AtLeast<O extends object, K extends string> = NoExpand<
    O extends unknown
    ? | (K extends keyof O ? { [P in K]: O[P] } & O : O)
      | {[P in keyof O as P extends K ? K : never]-?: O[P]} & O
    : never>;

  type _Strict<U, _U = U> = U extends unknown ? U & OptionalFlat<_Record<Exclude<Keys<_U>, keyof U>, never>> : never;

  export type Strict<U extends object> = ComputeRaw<_Strict<U>>;
  /** End Helper Types for "Merge" **/

  export type Merge<U extends object> = ComputeRaw<_Merge<Strict<U>>>;

  /**
  A [[Boolean]]
  */
  export type Boolean = True | False

  // /**
  // 1
  // */
  export type True = 1

  /**
  0
  */
  export type False = 0

  export type Not<B extends Boolean> = {
    0: 1
    1: 0
  }[B]

  export type Extends<A1 extends any, A2 extends any> = [A1] extends [never]
    ? 0 // anything `never` is false
    : A1 extends A2
    ? 1
    : 0

  export type Has<U extends Union, U1 extends Union> = Not<
    Extends<Exclude<U1, U>, U1>
  >

  export type Or<B1 extends Boolean, B2 extends Boolean> = {
    0: {
      0: 0
      1: 1
    }
    1: {
      0: 1
      1: 1
    }
  }[B1][B2]

  export type Keys<U extends Union> = U extends unknown ? keyof U : never

  type Cast<A, B> = A extends B ? A : B;

  export const type: unique symbol;



  /**
   * Used by group by
   */

  export type GetScalarType<T, O> = O extends object ? {
    [P in keyof T]: P extends keyof O
      ? O[P]
      : never
  } : never

  type FieldPaths<
    T,
    U = Omit<T, '_avg' | '_sum' | '_count' | '_min' | '_max'>
  > = IsObject<T> extends True ? U : T

  type GetHavingFields<T> = {
    [K in keyof T]: Or<
      Or<Extends<'OR', K>, Extends<'AND', K>>,
      Extends<'NOT', K>
    > extends True
      ? // infer is only needed to not hit TS limit
        // based on the brilliant idea of Pierre-Antoine Mills
        // https://github.com/microsoft/TypeScript/issues/30188#issuecomment-478938437
        T[K] extends infer TK
        ? GetHavingFields<UnEnumerate<TK> extends object ? Merge<UnEnumerate<TK>> : never>
        : never
      : {} extends FieldPaths<T[K]>
      ? never
      : K
  }[keyof T]

  /**
   * Convert tuple to union
   */
  type _TupleToUnion<T> = T extends (infer E)[] ? E : never
  type TupleToUnion<K extends readonly any[]> = _TupleToUnion<K>
  type MaybeTupleToUnion<T> = T extends any[] ? TupleToUnion<T> : T

  /**
   * Like `Pick`, but additionally can also accept an array of keys
   */
  type PickEnumerable<T, K extends Enumerable<keyof T> | keyof T> = Prisma__Pick<T, MaybeTupleToUnion<K>>

  /**
   * Exclude all keys with underscores
   */
  type ExcludeUnderscoreKeys<T extends string> = T extends `_${string}` ? never : T


  export type FieldRef<Model, FieldType> = runtime.FieldRef<Model, FieldType>

  type FieldRefInputType<Model, FieldType> = Model extends never ? never : FieldRef<Model, FieldType>


  export const ModelName: {
    Build: 'Build',
    Session: 'Session',
    SessionLog: 'SessionLog',
    Log: 'Log',
    Profiling: 'Profiling',
    App: 'App',
    Device: 'Device',
    PendingSession: 'PendingSession',
    CLIArgs: 'CLIArgs',
    WebhookConfig: 'WebhookConfig',
    WebConfig: 'WebConfig',
    LocatorEtalon: 'LocatorEtalon'
  };

  export type ModelName = (typeof ModelName)[keyof typeof ModelName]


  export type Datasources = {
    db?: Datasource
  }

  interface TypeMapCb extends $Utils.Fn<{extArgs: $Extensions.InternalArgs, clientOptions: PrismaClientOptions }, $Utils.Record<string, any>> {
    returns: Prisma.TypeMap<this['params']['extArgs'], this['params']['clientOptions']>
  }

  export type TypeMap<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, ClientOptions = {}> = {
    meta: {
      modelProps: "build" | "session" | "sessionLog" | "log" | "profiling" | "app" | "device" | "pendingSession" | "cLIArgs" | "webhookConfig" | "webConfig" | "locatorEtalon"
      txIsolationLevel: Prisma.TransactionIsolationLevel
    }
    model: {
      Build: {
        payload: Prisma.$BuildPayload<ExtArgs>
        fields: Prisma.BuildFieldRefs
        operations: {
          findUnique: {
            args: Prisma.BuildFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BuildPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.BuildFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BuildPayload>
          }
          findFirst: {
            args: Prisma.BuildFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BuildPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.BuildFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BuildPayload>
          }
          findMany: {
            args: Prisma.BuildFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BuildPayload>[]
          }
          create: {
            args: Prisma.BuildCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BuildPayload>
          }
          createMany: {
            args: Prisma.BuildCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.BuildCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BuildPayload>[]
          }
          delete: {
            args: Prisma.BuildDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BuildPayload>
          }
          update: {
            args: Prisma.BuildUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BuildPayload>
          }
          deleteMany: {
            args: Prisma.BuildDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.BuildUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.BuildUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BuildPayload>
          }
          aggregate: {
            args: Prisma.BuildAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateBuild>
          }
          groupBy: {
            args: Prisma.BuildGroupByArgs<ExtArgs>
            result: $Utils.Optional<BuildGroupByOutputType>[]
          }
          count: {
            args: Prisma.BuildCountArgs<ExtArgs>
            result: $Utils.Optional<BuildCountAggregateOutputType> | number
          }
        }
      }
      Session: {
        payload: Prisma.$SessionPayload<ExtArgs>
        fields: Prisma.SessionFieldRefs
        operations: {
          findUnique: {
            args: Prisma.SessionFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SessionPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.SessionFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SessionPayload>
          }
          findFirst: {
            args: Prisma.SessionFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SessionPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.SessionFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SessionPayload>
          }
          findMany: {
            args: Prisma.SessionFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SessionPayload>[]
          }
          create: {
            args: Prisma.SessionCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SessionPayload>
          }
          createMany: {
            args: Prisma.SessionCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.SessionCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SessionPayload>[]
          }
          delete: {
            args: Prisma.SessionDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SessionPayload>
          }
          update: {
            args: Prisma.SessionUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SessionPayload>
          }
          deleteMany: {
            args: Prisma.SessionDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.SessionUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.SessionUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SessionPayload>
          }
          aggregate: {
            args: Prisma.SessionAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateSession>
          }
          groupBy: {
            args: Prisma.SessionGroupByArgs<ExtArgs>
            result: $Utils.Optional<SessionGroupByOutputType>[]
          }
          count: {
            args: Prisma.SessionCountArgs<ExtArgs>
            result: $Utils.Optional<SessionCountAggregateOutputType> | number
          }
        }
      }
      SessionLog: {
        payload: Prisma.$SessionLogPayload<ExtArgs>
        fields: Prisma.SessionLogFieldRefs
        operations: {
          findUnique: {
            args: Prisma.SessionLogFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SessionLogPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.SessionLogFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SessionLogPayload>
          }
          findFirst: {
            args: Prisma.SessionLogFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SessionLogPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.SessionLogFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SessionLogPayload>
          }
          findMany: {
            args: Prisma.SessionLogFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SessionLogPayload>[]
          }
          create: {
            args: Prisma.SessionLogCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SessionLogPayload>
          }
          createMany: {
            args: Prisma.SessionLogCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.SessionLogCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SessionLogPayload>[]
          }
          delete: {
            args: Prisma.SessionLogDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SessionLogPayload>
          }
          update: {
            args: Prisma.SessionLogUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SessionLogPayload>
          }
          deleteMany: {
            args: Prisma.SessionLogDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.SessionLogUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.SessionLogUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SessionLogPayload>
          }
          aggregate: {
            args: Prisma.SessionLogAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateSessionLog>
          }
          groupBy: {
            args: Prisma.SessionLogGroupByArgs<ExtArgs>
            result: $Utils.Optional<SessionLogGroupByOutputType>[]
          }
          count: {
            args: Prisma.SessionLogCountArgs<ExtArgs>
            result: $Utils.Optional<SessionLogCountAggregateOutputType> | number
          }
        }
      }
      Log: {
        payload: Prisma.$LogPayload<ExtArgs>
        fields: Prisma.LogFieldRefs
        operations: {
          findUnique: {
            args: Prisma.LogFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LogPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.LogFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LogPayload>
          }
          findFirst: {
            args: Prisma.LogFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LogPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.LogFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LogPayload>
          }
          findMany: {
            args: Prisma.LogFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LogPayload>[]
          }
          create: {
            args: Prisma.LogCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LogPayload>
          }
          createMany: {
            args: Prisma.LogCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.LogCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LogPayload>[]
          }
          delete: {
            args: Prisma.LogDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LogPayload>
          }
          update: {
            args: Prisma.LogUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LogPayload>
          }
          deleteMany: {
            args: Prisma.LogDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.LogUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.LogUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LogPayload>
          }
          aggregate: {
            args: Prisma.LogAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateLog>
          }
          groupBy: {
            args: Prisma.LogGroupByArgs<ExtArgs>
            result: $Utils.Optional<LogGroupByOutputType>[]
          }
          count: {
            args: Prisma.LogCountArgs<ExtArgs>
            result: $Utils.Optional<LogCountAggregateOutputType> | number
          }
        }
      }
      Profiling: {
        payload: Prisma.$ProfilingPayload<ExtArgs>
        fields: Prisma.ProfilingFieldRefs
        operations: {
          findUnique: {
            args: Prisma.ProfilingFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ProfilingPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.ProfilingFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ProfilingPayload>
          }
          findFirst: {
            args: Prisma.ProfilingFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ProfilingPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.ProfilingFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ProfilingPayload>
          }
          findMany: {
            args: Prisma.ProfilingFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ProfilingPayload>[]
          }
          create: {
            args: Prisma.ProfilingCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ProfilingPayload>
          }
          createMany: {
            args: Prisma.ProfilingCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.ProfilingCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ProfilingPayload>[]
          }
          delete: {
            args: Prisma.ProfilingDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ProfilingPayload>
          }
          update: {
            args: Prisma.ProfilingUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ProfilingPayload>
          }
          deleteMany: {
            args: Prisma.ProfilingDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.ProfilingUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.ProfilingUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ProfilingPayload>
          }
          aggregate: {
            args: Prisma.ProfilingAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateProfiling>
          }
          groupBy: {
            args: Prisma.ProfilingGroupByArgs<ExtArgs>
            result: $Utils.Optional<ProfilingGroupByOutputType>[]
          }
          count: {
            args: Prisma.ProfilingCountArgs<ExtArgs>
            result: $Utils.Optional<ProfilingCountAggregateOutputType> | number
          }
        }
      }
      App: {
        payload: Prisma.$AppPayload<ExtArgs>
        fields: Prisma.AppFieldRefs
        operations: {
          findUnique: {
            args: Prisma.AppFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AppPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.AppFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AppPayload>
          }
          findFirst: {
            args: Prisma.AppFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AppPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.AppFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AppPayload>
          }
          findMany: {
            args: Prisma.AppFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AppPayload>[]
          }
          create: {
            args: Prisma.AppCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AppPayload>
          }
          createMany: {
            args: Prisma.AppCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.AppCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AppPayload>[]
          }
          delete: {
            args: Prisma.AppDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AppPayload>
          }
          update: {
            args: Prisma.AppUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AppPayload>
          }
          deleteMany: {
            args: Prisma.AppDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.AppUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.AppUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AppPayload>
          }
          aggregate: {
            args: Prisma.AppAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateApp>
          }
          groupBy: {
            args: Prisma.AppGroupByArgs<ExtArgs>
            result: $Utils.Optional<AppGroupByOutputType>[]
          }
          count: {
            args: Prisma.AppCountArgs<ExtArgs>
            result: $Utils.Optional<AppCountAggregateOutputType> | number
          }
        }
      }
      Device: {
        payload: Prisma.$DevicePayload<ExtArgs>
        fields: Prisma.DeviceFieldRefs
        operations: {
          findUnique: {
            args: Prisma.DeviceFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$DevicePayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.DeviceFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$DevicePayload>
          }
          findFirst: {
            args: Prisma.DeviceFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$DevicePayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.DeviceFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$DevicePayload>
          }
          findMany: {
            args: Prisma.DeviceFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$DevicePayload>[]
          }
          create: {
            args: Prisma.DeviceCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$DevicePayload>
          }
          createMany: {
            args: Prisma.DeviceCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.DeviceCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$DevicePayload>[]
          }
          delete: {
            args: Prisma.DeviceDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$DevicePayload>
          }
          update: {
            args: Prisma.DeviceUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$DevicePayload>
          }
          deleteMany: {
            args: Prisma.DeviceDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.DeviceUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.DeviceUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$DevicePayload>
          }
          aggregate: {
            args: Prisma.DeviceAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateDevice>
          }
          groupBy: {
            args: Prisma.DeviceGroupByArgs<ExtArgs>
            result: $Utils.Optional<DeviceGroupByOutputType>[]
          }
          count: {
            args: Prisma.DeviceCountArgs<ExtArgs>
            result: $Utils.Optional<DeviceCountAggregateOutputType> | number
          }
        }
      }
      PendingSession: {
        payload: Prisma.$PendingSessionPayload<ExtArgs>
        fields: Prisma.PendingSessionFieldRefs
        operations: {
          findUnique: {
            args: Prisma.PendingSessionFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PendingSessionPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.PendingSessionFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PendingSessionPayload>
          }
          findFirst: {
            args: Prisma.PendingSessionFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PendingSessionPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.PendingSessionFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PendingSessionPayload>
          }
          findMany: {
            args: Prisma.PendingSessionFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PendingSessionPayload>[]
          }
          create: {
            args: Prisma.PendingSessionCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PendingSessionPayload>
          }
          createMany: {
            args: Prisma.PendingSessionCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.PendingSessionCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PendingSessionPayload>[]
          }
          delete: {
            args: Prisma.PendingSessionDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PendingSessionPayload>
          }
          update: {
            args: Prisma.PendingSessionUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PendingSessionPayload>
          }
          deleteMany: {
            args: Prisma.PendingSessionDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.PendingSessionUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.PendingSessionUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PendingSessionPayload>
          }
          aggregate: {
            args: Prisma.PendingSessionAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregatePendingSession>
          }
          groupBy: {
            args: Prisma.PendingSessionGroupByArgs<ExtArgs>
            result: $Utils.Optional<PendingSessionGroupByOutputType>[]
          }
          count: {
            args: Prisma.PendingSessionCountArgs<ExtArgs>
            result: $Utils.Optional<PendingSessionCountAggregateOutputType> | number
          }
        }
      }
      CLIArgs: {
        payload: Prisma.$CLIArgsPayload<ExtArgs>
        fields: Prisma.CLIArgsFieldRefs
        operations: {
          findUnique: {
            args: Prisma.CLIArgsFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CLIArgsPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.CLIArgsFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CLIArgsPayload>
          }
          findFirst: {
            args: Prisma.CLIArgsFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CLIArgsPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.CLIArgsFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CLIArgsPayload>
          }
          findMany: {
            args: Prisma.CLIArgsFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CLIArgsPayload>[]
          }
          create: {
            args: Prisma.CLIArgsCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CLIArgsPayload>
          }
          createMany: {
            args: Prisma.CLIArgsCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.CLIArgsCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CLIArgsPayload>[]
          }
          delete: {
            args: Prisma.CLIArgsDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CLIArgsPayload>
          }
          update: {
            args: Prisma.CLIArgsUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CLIArgsPayload>
          }
          deleteMany: {
            args: Prisma.CLIArgsDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.CLIArgsUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.CLIArgsUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CLIArgsPayload>
          }
          aggregate: {
            args: Prisma.CLIArgsAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateCLIArgs>
          }
          groupBy: {
            args: Prisma.CLIArgsGroupByArgs<ExtArgs>
            result: $Utils.Optional<CLIArgsGroupByOutputType>[]
          }
          count: {
            args: Prisma.CLIArgsCountArgs<ExtArgs>
            result: $Utils.Optional<CLIArgsCountAggregateOutputType> | number
          }
        }
      }
      WebhookConfig: {
        payload: Prisma.$WebhookConfigPayload<ExtArgs>
        fields: Prisma.WebhookConfigFieldRefs
        operations: {
          findUnique: {
            args: Prisma.WebhookConfigFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WebhookConfigPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.WebhookConfigFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WebhookConfigPayload>
          }
          findFirst: {
            args: Prisma.WebhookConfigFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WebhookConfigPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.WebhookConfigFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WebhookConfigPayload>
          }
          findMany: {
            args: Prisma.WebhookConfigFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WebhookConfigPayload>[]
          }
          create: {
            args: Prisma.WebhookConfigCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WebhookConfigPayload>
          }
          createMany: {
            args: Prisma.WebhookConfigCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.WebhookConfigCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WebhookConfigPayload>[]
          }
          delete: {
            args: Prisma.WebhookConfigDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WebhookConfigPayload>
          }
          update: {
            args: Prisma.WebhookConfigUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WebhookConfigPayload>
          }
          deleteMany: {
            args: Prisma.WebhookConfigDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.WebhookConfigUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.WebhookConfigUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WebhookConfigPayload>
          }
          aggregate: {
            args: Prisma.WebhookConfigAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateWebhookConfig>
          }
          groupBy: {
            args: Prisma.WebhookConfigGroupByArgs<ExtArgs>
            result: $Utils.Optional<WebhookConfigGroupByOutputType>[]
          }
          count: {
            args: Prisma.WebhookConfigCountArgs<ExtArgs>
            result: $Utils.Optional<WebhookConfigCountAggregateOutputType> | number
          }
        }
      }
      WebConfig: {
        payload: Prisma.$WebConfigPayload<ExtArgs>
        fields: Prisma.WebConfigFieldRefs
        operations: {
          findUnique: {
            args: Prisma.WebConfigFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WebConfigPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.WebConfigFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WebConfigPayload>
          }
          findFirst: {
            args: Prisma.WebConfigFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WebConfigPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.WebConfigFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WebConfigPayload>
          }
          findMany: {
            args: Prisma.WebConfigFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WebConfigPayload>[]
          }
          create: {
            args: Prisma.WebConfigCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WebConfigPayload>
          }
          createMany: {
            args: Prisma.WebConfigCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.WebConfigCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WebConfigPayload>[]
          }
          delete: {
            args: Prisma.WebConfigDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WebConfigPayload>
          }
          update: {
            args: Prisma.WebConfigUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WebConfigPayload>
          }
          deleteMany: {
            args: Prisma.WebConfigDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.WebConfigUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.WebConfigUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$WebConfigPayload>
          }
          aggregate: {
            args: Prisma.WebConfigAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateWebConfig>
          }
          groupBy: {
            args: Prisma.WebConfigGroupByArgs<ExtArgs>
            result: $Utils.Optional<WebConfigGroupByOutputType>[]
          }
          count: {
            args: Prisma.WebConfigCountArgs<ExtArgs>
            result: $Utils.Optional<WebConfigCountAggregateOutputType> | number
          }
        }
      }
      LocatorEtalon: {
        payload: Prisma.$LocatorEtalonPayload<ExtArgs>
        fields: Prisma.LocatorEtalonFieldRefs
        operations: {
          findUnique: {
            args: Prisma.LocatorEtalonFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LocatorEtalonPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.LocatorEtalonFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LocatorEtalonPayload>
          }
          findFirst: {
            args: Prisma.LocatorEtalonFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LocatorEtalonPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.LocatorEtalonFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LocatorEtalonPayload>
          }
          findMany: {
            args: Prisma.LocatorEtalonFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LocatorEtalonPayload>[]
          }
          create: {
            args: Prisma.LocatorEtalonCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LocatorEtalonPayload>
          }
          createMany: {
            args: Prisma.LocatorEtalonCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.LocatorEtalonCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LocatorEtalonPayload>[]
          }
          delete: {
            args: Prisma.LocatorEtalonDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LocatorEtalonPayload>
          }
          update: {
            args: Prisma.LocatorEtalonUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LocatorEtalonPayload>
          }
          deleteMany: {
            args: Prisma.LocatorEtalonDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.LocatorEtalonUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.LocatorEtalonUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LocatorEtalonPayload>
          }
          aggregate: {
            args: Prisma.LocatorEtalonAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateLocatorEtalon>
          }
          groupBy: {
            args: Prisma.LocatorEtalonGroupByArgs<ExtArgs>
            result: $Utils.Optional<LocatorEtalonGroupByOutputType>[]
          }
          count: {
            args: Prisma.LocatorEtalonCountArgs<ExtArgs>
            result: $Utils.Optional<LocatorEtalonCountAggregateOutputType> | number
          }
        }
      }
    }
  } & {
    other: {
      payload: any
      operations: {
        $executeRaw: {
          args: [query: TemplateStringsArray | Prisma.Sql, ...values: any[]],
          result: any
        }
        $executeRawUnsafe: {
          args: [query: string, ...values: any[]],
          result: any
        }
        $queryRaw: {
          args: [query: TemplateStringsArray | Prisma.Sql, ...values: any[]],
          result: any
        }
        $queryRawUnsafe: {
          args: [query: string, ...values: any[]],
          result: any
        }
      }
    }
  }
  export const defineExtension: $Extensions.ExtendsHook<"define", Prisma.TypeMapCb, $Extensions.DefaultArgs>
  export type DefaultPrismaClient = PrismaClient
  export type ErrorFormat = 'pretty' | 'colorless' | 'minimal'
  export interface PrismaClientOptions {
    /**
     * Overwrites the datasource url from your schema.prisma file
     */
    datasources?: Datasources
    /**
     * Overwrites the datasource url from your schema.prisma file
     */
    datasourceUrl?: string
    /**
     * @default "colorless"
     */
    errorFormat?: ErrorFormat
    /**
     * @example
     * ```
     * // Defaults to stdout
     * log: ['query', 'info', 'warn', 'error']
     * 
     * // Emit as events
     * log: [
     *   { emit: 'stdout', level: 'query' },
     *   { emit: 'stdout', level: 'info' },
     *   { emit: 'stdout', level: 'warn' }
     *   { emit: 'stdout', level: 'error' }
     * ]
     * ```
     * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/logging#the-log-option).
     */
    log?: (LogLevel | LogDefinition)[]
    /**
     * The default values for transactionOptions
     * maxWait ?= 2000
     * timeout ?= 5000
     */
    transactionOptions?: {
      maxWait?: number
      timeout?: number
      isolationLevel?: Prisma.TransactionIsolationLevel
    }
  }


  /* Types for Logging */
  export type LogLevel = 'info' | 'query' | 'warn' | 'error'
  export type LogDefinition = {
    level: LogLevel
    emit: 'stdout' | 'event'
  }

  export type GetLogType<T extends LogLevel | LogDefinition> = T extends LogDefinition ? T['emit'] extends 'event' ? T['level'] : never : never
  export type GetEvents<T extends any> = T extends Array<LogLevel | LogDefinition> ?
    GetLogType<T[0]> | GetLogType<T[1]> | GetLogType<T[2]> | GetLogType<T[3]>
    : never

  export type QueryEvent = {
    timestamp: Date
    query: string
    params: string
    duration: number
    target: string
  }

  export type LogEvent = {
    timestamp: Date
    message: string
    target: string
  }
  /* End Types for Logging */


  export type PrismaAction =
    | 'findUnique'
    | 'findUniqueOrThrow'
    | 'findMany'
    | 'findFirst'
    | 'findFirstOrThrow'
    | 'create'
    | 'createMany'
    | 'createManyAndReturn'
    | 'update'
    | 'updateMany'
    | 'upsert'
    | 'delete'
    | 'deleteMany'
    | 'executeRaw'
    | 'queryRaw'
    | 'aggregate'
    | 'count'
    | 'runCommandRaw'
    | 'findRaw'
    | 'groupBy'

  /**
   * These options are being passed into the middleware as "params"
   */
  export type MiddlewareParams = {
    model?: ModelName
    action: PrismaAction
    args: any
    dataPath: string[]
    runInTransaction: boolean
  }

  /**
   * The `T` type makes sure, that the `return proceed` is not forgotten in the middleware implementation
   */
  export type Middleware<T = any> = (
    params: MiddlewareParams,
    next: (params: MiddlewareParams) => $Utils.JsPromise<T>,
  ) => $Utils.JsPromise<T>

  // tested in getLogLevel.test.ts
  export function getLogLevel(log: Array<LogLevel | LogDefinition>): LogLevel | undefined;

  /**
   * `PrismaClient` proxy available in interactive transactions.
   */
  export type TransactionClient = Omit<Prisma.DefaultPrismaClient, runtime.ITXClientDenyList>

  export type Datasource = {
    url?: string
  }

  /**
   * Count Types
   */


  /**
   * Count Type BuildCountOutputType
   */

  export type BuildCountOutputType = {
    sessions: number
  }

  export type BuildCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    sessions?: boolean | BuildCountOutputTypeCountSessionsArgs
  }

  // Custom InputTypes
  /**
   * BuildCountOutputType without action
   */
  export type BuildCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BuildCountOutputType
     */
    select?: BuildCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * BuildCountOutputType without action
   */
  export type BuildCountOutputTypeCountSessionsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: SessionWhereInput
  }


  /**
   * Count Type SessionCountOutputType
   */

  export type SessionCountOutputType = {
    Log: number
    Profiling: number
    SessionLog: number
  }

  export type SessionCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    Log?: boolean | SessionCountOutputTypeCountLogArgs
    Profiling?: boolean | SessionCountOutputTypeCountProfilingArgs
    SessionLog?: boolean | SessionCountOutputTypeCountSessionLogArgs
  }

  // Custom InputTypes
  /**
   * SessionCountOutputType without action
   */
  export type SessionCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SessionCountOutputType
     */
    select?: SessionCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * SessionCountOutputType without action
   */
  export type SessionCountOutputTypeCountLogArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: LogWhereInput
  }

  /**
   * SessionCountOutputType without action
   */
  export type SessionCountOutputTypeCountProfilingArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: ProfilingWhereInput
  }

  /**
   * SessionCountOutputType without action
   */
  export type SessionCountOutputTypeCountSessionLogArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: SessionLogWhereInput
  }


  /**
   * Models
   */

  /**
   * Model Build
   */

  export type AggregateBuild = {
    _count: BuildCountAggregateOutputType | null
    _min: BuildMinAggregateOutputType | null
    _max: BuildMaxAggregateOutputType | null
  }

  export type BuildMinAggregateOutputType = {
    id: string | null
    name: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type BuildMaxAggregateOutputType = {
    id: string | null
    name: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type BuildCountAggregateOutputType = {
    id: number
    name: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type BuildMinAggregateInputType = {
    id?: true
    name?: true
    createdAt?: true
    updatedAt?: true
  }

  export type BuildMaxAggregateInputType = {
    id?: true
    name?: true
    createdAt?: true
    updatedAt?: true
  }

  export type BuildCountAggregateInputType = {
    id?: true
    name?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type BuildAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Build to aggregate.
     */
    where?: BuildWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Builds to fetch.
     */
    orderBy?: BuildOrderByWithRelationInput | BuildOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: BuildWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Builds from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Builds.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Builds
    **/
    _count?: true | BuildCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: BuildMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: BuildMaxAggregateInputType
  }

  export type GetBuildAggregateType<T extends BuildAggregateArgs> = {
        [P in keyof T & keyof AggregateBuild]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateBuild[P]>
      : GetScalarType<T[P], AggregateBuild[P]>
  }




  export type BuildGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: BuildWhereInput
    orderBy?: BuildOrderByWithAggregationInput | BuildOrderByWithAggregationInput[]
    by: BuildScalarFieldEnum[] | BuildScalarFieldEnum
    having?: BuildScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: BuildCountAggregateInputType | true
    _min?: BuildMinAggregateInputType
    _max?: BuildMaxAggregateInputType
  }

  export type BuildGroupByOutputType = {
    id: string
    name: string | null
    createdAt: Date
    updatedAt: Date
    _count: BuildCountAggregateOutputType | null
    _min: BuildMinAggregateOutputType | null
    _max: BuildMaxAggregateOutputType | null
  }

  type GetBuildGroupByPayload<T extends BuildGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<BuildGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof BuildGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], BuildGroupByOutputType[P]>
            : GetScalarType<T[P], BuildGroupByOutputType[P]>
        }
      >
    >


  export type BuildSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    sessions?: boolean | Build$sessionsArgs<ExtArgs>
    _count?: boolean | BuildCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["build"]>

  export type BuildSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["build"]>

  export type BuildSelectScalar = {
    id?: boolean
    name?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type BuildInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    sessions?: boolean | Build$sessionsArgs<ExtArgs>
    _count?: boolean | BuildCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type BuildIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}

  export type $BuildPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Build"
    objects: {
      sessions: Prisma.$SessionPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      name: string | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["build"]>
    composites: {}
  }

  type BuildGetPayload<S extends boolean | null | undefined | BuildDefaultArgs> = $Result.GetResult<Prisma.$BuildPayload, S>

  type BuildCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<BuildFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: BuildCountAggregateInputType | true
    }

  export interface BuildDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Build'], meta: { name: 'Build' } }
    /**
     * Find zero or one Build that matches the filter.
     * @param {BuildFindUniqueArgs} args - Arguments to find a Build
     * @example
     * // Get one Build
     * const build = await prisma.build.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends BuildFindUniqueArgs>(args: SelectSubset<T, BuildFindUniqueArgs<ExtArgs>>): Prisma__BuildClient<$Result.GetResult<Prisma.$BuildPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Build that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {BuildFindUniqueOrThrowArgs} args - Arguments to find a Build
     * @example
     * // Get one Build
     * const build = await prisma.build.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends BuildFindUniqueOrThrowArgs>(args: SelectSubset<T, BuildFindUniqueOrThrowArgs<ExtArgs>>): Prisma__BuildClient<$Result.GetResult<Prisma.$BuildPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Build that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BuildFindFirstArgs} args - Arguments to find a Build
     * @example
     * // Get one Build
     * const build = await prisma.build.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends BuildFindFirstArgs>(args?: SelectSubset<T, BuildFindFirstArgs<ExtArgs>>): Prisma__BuildClient<$Result.GetResult<Prisma.$BuildPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Build that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BuildFindFirstOrThrowArgs} args - Arguments to find a Build
     * @example
     * // Get one Build
     * const build = await prisma.build.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends BuildFindFirstOrThrowArgs>(args?: SelectSubset<T, BuildFindFirstOrThrowArgs<ExtArgs>>): Prisma__BuildClient<$Result.GetResult<Prisma.$BuildPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Builds that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BuildFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Builds
     * const builds = await prisma.build.findMany()
     * 
     * // Get first 10 Builds
     * const builds = await prisma.build.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const buildWithIdOnly = await prisma.build.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends BuildFindManyArgs>(args?: SelectSubset<T, BuildFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$BuildPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Build.
     * @param {BuildCreateArgs} args - Arguments to create a Build.
     * @example
     * // Create one Build
     * const Build = await prisma.build.create({
     *   data: {
     *     // ... data to create a Build
     *   }
     * })
     * 
     */
    create<T extends BuildCreateArgs>(args: SelectSubset<T, BuildCreateArgs<ExtArgs>>): Prisma__BuildClient<$Result.GetResult<Prisma.$BuildPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Builds.
     * @param {BuildCreateManyArgs} args - Arguments to create many Builds.
     * @example
     * // Create many Builds
     * const build = await prisma.build.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends BuildCreateManyArgs>(args?: SelectSubset<T, BuildCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Builds and returns the data saved in the database.
     * @param {BuildCreateManyAndReturnArgs} args - Arguments to create many Builds.
     * @example
     * // Create many Builds
     * const build = await prisma.build.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Builds and only return the `id`
     * const buildWithIdOnly = await prisma.build.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends BuildCreateManyAndReturnArgs>(args?: SelectSubset<T, BuildCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$BuildPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Build.
     * @param {BuildDeleteArgs} args - Arguments to delete one Build.
     * @example
     * // Delete one Build
     * const Build = await prisma.build.delete({
     *   where: {
     *     // ... filter to delete one Build
     *   }
     * })
     * 
     */
    delete<T extends BuildDeleteArgs>(args: SelectSubset<T, BuildDeleteArgs<ExtArgs>>): Prisma__BuildClient<$Result.GetResult<Prisma.$BuildPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Build.
     * @param {BuildUpdateArgs} args - Arguments to update one Build.
     * @example
     * // Update one Build
     * const build = await prisma.build.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends BuildUpdateArgs>(args: SelectSubset<T, BuildUpdateArgs<ExtArgs>>): Prisma__BuildClient<$Result.GetResult<Prisma.$BuildPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Builds.
     * @param {BuildDeleteManyArgs} args - Arguments to filter Builds to delete.
     * @example
     * // Delete a few Builds
     * const { count } = await prisma.build.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends BuildDeleteManyArgs>(args?: SelectSubset<T, BuildDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Builds.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BuildUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Builds
     * const build = await prisma.build.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends BuildUpdateManyArgs>(args: SelectSubset<T, BuildUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Build.
     * @param {BuildUpsertArgs} args - Arguments to update or create a Build.
     * @example
     * // Update or create a Build
     * const build = await prisma.build.upsert({
     *   create: {
     *     // ... data to create a Build
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Build we want to update
     *   }
     * })
     */
    upsert<T extends BuildUpsertArgs>(args: SelectSubset<T, BuildUpsertArgs<ExtArgs>>): Prisma__BuildClient<$Result.GetResult<Prisma.$BuildPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Builds.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BuildCountArgs} args - Arguments to filter Builds to count.
     * @example
     * // Count the number of Builds
     * const count = await prisma.build.count({
     *   where: {
     *     // ... the filter for the Builds we want to count
     *   }
     * })
    **/
    count<T extends BuildCountArgs>(
      args?: Subset<T, BuildCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], BuildCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Build.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BuildAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends BuildAggregateArgs>(args: Subset<T, BuildAggregateArgs>): Prisma.PrismaPromise<GetBuildAggregateType<T>>

    /**
     * Group by Build.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BuildGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends BuildGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: BuildGroupByArgs['orderBy'] }
        : { orderBy?: BuildGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, BuildGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetBuildGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Build model
   */
  readonly fields: BuildFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Build.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__BuildClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    sessions<T extends Build$sessionsArgs<ExtArgs> = {}>(args?: Subset<T, Build$sessionsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$SessionPayload<ExtArgs>, T, "findMany"> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Build model
   */ 
  interface BuildFieldRefs {
    readonly id: FieldRef<"Build", 'String'>
    readonly name: FieldRef<"Build", 'String'>
    readonly createdAt: FieldRef<"Build", 'DateTime'>
    readonly updatedAt: FieldRef<"Build", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Build findUnique
   */
  export type BuildFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Build
     */
    select?: BuildSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: BuildInclude<ExtArgs> | null
    /**
     * Filter, which Build to fetch.
     */
    where: BuildWhereUniqueInput
  }

  /**
   * Build findUniqueOrThrow
   */
  export type BuildFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Build
     */
    select?: BuildSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: BuildInclude<ExtArgs> | null
    /**
     * Filter, which Build to fetch.
     */
    where: BuildWhereUniqueInput
  }

  /**
   * Build findFirst
   */
  export type BuildFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Build
     */
    select?: BuildSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: BuildInclude<ExtArgs> | null
    /**
     * Filter, which Build to fetch.
     */
    where?: BuildWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Builds to fetch.
     */
    orderBy?: BuildOrderByWithRelationInput | BuildOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Builds.
     */
    cursor?: BuildWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Builds from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Builds.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Builds.
     */
    distinct?: BuildScalarFieldEnum | BuildScalarFieldEnum[]
  }

  /**
   * Build findFirstOrThrow
   */
  export type BuildFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Build
     */
    select?: BuildSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: BuildInclude<ExtArgs> | null
    /**
     * Filter, which Build to fetch.
     */
    where?: BuildWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Builds to fetch.
     */
    orderBy?: BuildOrderByWithRelationInput | BuildOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Builds.
     */
    cursor?: BuildWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Builds from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Builds.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Builds.
     */
    distinct?: BuildScalarFieldEnum | BuildScalarFieldEnum[]
  }

  /**
   * Build findMany
   */
  export type BuildFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Build
     */
    select?: BuildSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: BuildInclude<ExtArgs> | null
    /**
     * Filter, which Builds to fetch.
     */
    where?: BuildWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Builds to fetch.
     */
    orderBy?: BuildOrderByWithRelationInput | BuildOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Builds.
     */
    cursor?: BuildWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Builds from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Builds.
     */
    skip?: number
    distinct?: BuildScalarFieldEnum | BuildScalarFieldEnum[]
  }

  /**
   * Build create
   */
  export type BuildCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Build
     */
    select?: BuildSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: BuildInclude<ExtArgs> | null
    /**
     * The data needed to create a Build.
     */
    data: XOR<BuildCreateInput, BuildUncheckedCreateInput>
  }

  /**
   * Build createMany
   */
  export type BuildCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Builds.
     */
    data: BuildCreateManyInput | BuildCreateManyInput[]
  }

  /**
   * Build createManyAndReturn
   */
  export type BuildCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Build
     */
    select?: BuildSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many Builds.
     */
    data: BuildCreateManyInput | BuildCreateManyInput[]
  }

  /**
   * Build update
   */
  export type BuildUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Build
     */
    select?: BuildSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: BuildInclude<ExtArgs> | null
    /**
     * The data needed to update a Build.
     */
    data: XOR<BuildUpdateInput, BuildUncheckedUpdateInput>
    /**
     * Choose, which Build to update.
     */
    where: BuildWhereUniqueInput
  }

  /**
   * Build updateMany
   */
  export type BuildUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Builds.
     */
    data: XOR<BuildUpdateManyMutationInput, BuildUncheckedUpdateManyInput>
    /**
     * Filter which Builds to update
     */
    where?: BuildWhereInput
  }

  /**
   * Build upsert
   */
  export type BuildUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Build
     */
    select?: BuildSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: BuildInclude<ExtArgs> | null
    /**
     * The filter to search for the Build to update in case it exists.
     */
    where: BuildWhereUniqueInput
    /**
     * In case the Build found by the `where` argument doesn't exist, create a new Build with this data.
     */
    create: XOR<BuildCreateInput, BuildUncheckedCreateInput>
    /**
     * In case the Build was found with the provided `where` argument, update it with this data.
     */
    update: XOR<BuildUpdateInput, BuildUncheckedUpdateInput>
  }

  /**
   * Build delete
   */
  export type BuildDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Build
     */
    select?: BuildSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: BuildInclude<ExtArgs> | null
    /**
     * Filter which Build to delete.
     */
    where: BuildWhereUniqueInput
  }

  /**
   * Build deleteMany
   */
  export type BuildDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Builds to delete
     */
    where?: BuildWhereInput
  }

  /**
   * Build.sessions
   */
  export type Build$sessionsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Session
     */
    select?: SessionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SessionInclude<ExtArgs> | null
    where?: SessionWhereInput
    orderBy?: SessionOrderByWithRelationInput | SessionOrderByWithRelationInput[]
    cursor?: SessionWhereUniqueInput
    take?: number
    skip?: number
    distinct?: SessionScalarFieldEnum | SessionScalarFieldEnum[]
  }

  /**
   * Build without action
   */
  export type BuildDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Build
     */
    select?: BuildSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: BuildInclude<ExtArgs> | null
  }


  /**
   * Model Session
   */

  export type AggregateSession = {
    _count: SessionCountAggregateOutputType | null
    _avg: SessionAvgAggregateOutputType | null
    _sum: SessionSumAggregateOutputType | null
    _min: SessionMinAggregateOutputType | null
    _max: SessionMaxAggregateOutputType | null
  }

  export type SessionAvgAggregateOutputType = {
    heartbeat_pid: number | null
  }

  export type SessionSumAggregateOutputType = {
    heartbeat_pid: number | null
  }

  export type SessionMinAggregateOutputType = {
    id: string | null
    build_id: string | null
    name: string | null
    status: string | null
    desired_capabilities: string | null
    session_capabilities: string | null
    node_id: string | null
    has_live_video: boolean | null
    video_recording_enabled: boolean | null
    video_recording: string | null
    startTime: Date | null
    endTime: Date | null
    failure_reason: string | null
    is_profiling_available: boolean | null
    device_info: string | null
    device_udid: string | null
    device_platform: string | null
    device_version: string | null
    device_name: string | null
    createdAt: Date | null
    updatedAt: Date | null
    performance_trace: string | null
    failure_category: string | null
    ai_analysis: string | null
    tags: string | null
    trace_id: string | null
    last_heartbeat_at: Date | null
    heartbeat_pid: number | null
    heartbeat_host: string | null
  }

  export type SessionMaxAggregateOutputType = {
    id: string | null
    build_id: string | null
    name: string | null
    status: string | null
    desired_capabilities: string | null
    session_capabilities: string | null
    node_id: string | null
    has_live_video: boolean | null
    video_recording_enabled: boolean | null
    video_recording: string | null
    startTime: Date | null
    endTime: Date | null
    failure_reason: string | null
    is_profiling_available: boolean | null
    device_info: string | null
    device_udid: string | null
    device_platform: string | null
    device_version: string | null
    device_name: string | null
    createdAt: Date | null
    updatedAt: Date | null
    performance_trace: string | null
    failure_category: string | null
    ai_analysis: string | null
    tags: string | null
    trace_id: string | null
    last_heartbeat_at: Date | null
    heartbeat_pid: number | null
    heartbeat_host: string | null
  }

  export type SessionCountAggregateOutputType = {
    id: number
    build_id: number
    name: number
    status: number
    desired_capabilities: number
    session_capabilities: number
    node_id: number
    has_live_video: number
    video_recording_enabled: number
    video_recording: number
    startTime: number
    endTime: number
    failure_reason: number
    is_profiling_available: number
    device_info: number
    device_udid: number
    device_platform: number
    device_version: number
    device_name: number
    createdAt: number
    updatedAt: number
    performance_trace: number
    failure_category: number
    ai_analysis: number
    tags: number
    trace_id: number
    last_heartbeat_at: number
    heartbeat_pid: number
    heartbeat_host: number
    _all: number
  }


  export type SessionAvgAggregateInputType = {
    heartbeat_pid?: true
  }

  export type SessionSumAggregateInputType = {
    heartbeat_pid?: true
  }

  export type SessionMinAggregateInputType = {
    id?: true
    build_id?: true
    name?: true
    status?: true
    desired_capabilities?: true
    session_capabilities?: true
    node_id?: true
    has_live_video?: true
    video_recording_enabled?: true
    video_recording?: true
    startTime?: true
    endTime?: true
    failure_reason?: true
    is_profiling_available?: true
    device_info?: true
    device_udid?: true
    device_platform?: true
    device_version?: true
    device_name?: true
    createdAt?: true
    updatedAt?: true
    performance_trace?: true
    failure_category?: true
    ai_analysis?: true
    tags?: true
    trace_id?: true
    last_heartbeat_at?: true
    heartbeat_pid?: true
    heartbeat_host?: true
  }

  export type SessionMaxAggregateInputType = {
    id?: true
    build_id?: true
    name?: true
    status?: true
    desired_capabilities?: true
    session_capabilities?: true
    node_id?: true
    has_live_video?: true
    video_recording_enabled?: true
    video_recording?: true
    startTime?: true
    endTime?: true
    failure_reason?: true
    is_profiling_available?: true
    device_info?: true
    device_udid?: true
    device_platform?: true
    device_version?: true
    device_name?: true
    createdAt?: true
    updatedAt?: true
    performance_trace?: true
    failure_category?: true
    ai_analysis?: true
    tags?: true
    trace_id?: true
    last_heartbeat_at?: true
    heartbeat_pid?: true
    heartbeat_host?: true
  }

  export type SessionCountAggregateInputType = {
    id?: true
    build_id?: true
    name?: true
    status?: true
    desired_capabilities?: true
    session_capabilities?: true
    node_id?: true
    has_live_video?: true
    video_recording_enabled?: true
    video_recording?: true
    startTime?: true
    endTime?: true
    failure_reason?: true
    is_profiling_available?: true
    device_info?: true
    device_udid?: true
    device_platform?: true
    device_version?: true
    device_name?: true
    createdAt?: true
    updatedAt?: true
    performance_trace?: true
    failure_category?: true
    ai_analysis?: true
    tags?: true
    trace_id?: true
    last_heartbeat_at?: true
    heartbeat_pid?: true
    heartbeat_host?: true
    _all?: true
  }

  export type SessionAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Session to aggregate.
     */
    where?: SessionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Sessions to fetch.
     */
    orderBy?: SessionOrderByWithRelationInput | SessionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: SessionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Sessions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Sessions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Sessions
    **/
    _count?: true | SessionCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: SessionAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: SessionSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: SessionMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: SessionMaxAggregateInputType
  }

  export type GetSessionAggregateType<T extends SessionAggregateArgs> = {
        [P in keyof T & keyof AggregateSession]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateSession[P]>
      : GetScalarType<T[P], AggregateSession[P]>
  }




  export type SessionGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: SessionWhereInput
    orderBy?: SessionOrderByWithAggregationInput | SessionOrderByWithAggregationInput[]
    by: SessionScalarFieldEnum[] | SessionScalarFieldEnum
    having?: SessionScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: SessionCountAggregateInputType | true
    _avg?: SessionAvgAggregateInputType
    _sum?: SessionSumAggregateInputType
    _min?: SessionMinAggregateInputType
    _max?: SessionMaxAggregateInputType
  }

  export type SessionGroupByOutputType = {
    id: string
    build_id: string | null
    name: string | null
    status: string
    desired_capabilities: string
    session_capabilities: string
    node_id: string
    has_live_video: boolean
    video_recording_enabled: boolean
    video_recording: string | null
    startTime: Date
    endTime: Date | null
    failure_reason: string | null
    is_profiling_available: boolean
    device_info: string | null
    device_udid: string
    device_platform: string
    device_version: string
    device_name: string | null
    createdAt: Date
    updatedAt: Date
    performance_trace: string | null
    failure_category: string | null
    ai_analysis: string | null
    tags: string | null
    trace_id: string | null
    last_heartbeat_at: Date | null
    heartbeat_pid: number | null
    heartbeat_host: string | null
    _count: SessionCountAggregateOutputType | null
    _avg: SessionAvgAggregateOutputType | null
    _sum: SessionSumAggregateOutputType | null
    _min: SessionMinAggregateOutputType | null
    _max: SessionMaxAggregateOutputType | null
  }

  type GetSessionGroupByPayload<T extends SessionGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<SessionGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof SessionGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], SessionGroupByOutputType[P]>
            : GetScalarType<T[P], SessionGroupByOutputType[P]>
        }
      >
    >


  export type SessionSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    build_id?: boolean
    name?: boolean
    status?: boolean
    desired_capabilities?: boolean
    session_capabilities?: boolean
    node_id?: boolean
    has_live_video?: boolean
    video_recording_enabled?: boolean
    video_recording?: boolean
    startTime?: boolean
    endTime?: boolean
    failure_reason?: boolean
    is_profiling_available?: boolean
    device_info?: boolean
    device_udid?: boolean
    device_platform?: boolean
    device_version?: boolean
    device_name?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    performance_trace?: boolean
    failure_category?: boolean
    ai_analysis?: boolean
    tags?: boolean
    trace_id?: boolean
    last_heartbeat_at?: boolean
    heartbeat_pid?: boolean
    heartbeat_host?: boolean
    Log?: boolean | Session$LogArgs<ExtArgs>
    Profiling?: boolean | Session$ProfilingArgs<ExtArgs>
    build?: boolean | Session$buildArgs<ExtArgs>
    SessionLog?: boolean | Session$SessionLogArgs<ExtArgs>
    _count?: boolean | SessionCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["session"]>

  export type SessionSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    build_id?: boolean
    name?: boolean
    status?: boolean
    desired_capabilities?: boolean
    session_capabilities?: boolean
    node_id?: boolean
    has_live_video?: boolean
    video_recording_enabled?: boolean
    video_recording?: boolean
    startTime?: boolean
    endTime?: boolean
    failure_reason?: boolean
    is_profiling_available?: boolean
    device_info?: boolean
    device_udid?: boolean
    device_platform?: boolean
    device_version?: boolean
    device_name?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    performance_trace?: boolean
    failure_category?: boolean
    ai_analysis?: boolean
    tags?: boolean
    trace_id?: boolean
    last_heartbeat_at?: boolean
    heartbeat_pid?: boolean
    heartbeat_host?: boolean
    build?: boolean | Session$buildArgs<ExtArgs>
  }, ExtArgs["result"]["session"]>

  export type SessionSelectScalar = {
    id?: boolean
    build_id?: boolean
    name?: boolean
    status?: boolean
    desired_capabilities?: boolean
    session_capabilities?: boolean
    node_id?: boolean
    has_live_video?: boolean
    video_recording_enabled?: boolean
    video_recording?: boolean
    startTime?: boolean
    endTime?: boolean
    failure_reason?: boolean
    is_profiling_available?: boolean
    device_info?: boolean
    device_udid?: boolean
    device_platform?: boolean
    device_version?: boolean
    device_name?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    performance_trace?: boolean
    failure_category?: boolean
    ai_analysis?: boolean
    tags?: boolean
    trace_id?: boolean
    last_heartbeat_at?: boolean
    heartbeat_pid?: boolean
    heartbeat_host?: boolean
  }

  export type SessionInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    Log?: boolean | Session$LogArgs<ExtArgs>
    Profiling?: boolean | Session$ProfilingArgs<ExtArgs>
    build?: boolean | Session$buildArgs<ExtArgs>
    SessionLog?: boolean | Session$SessionLogArgs<ExtArgs>
    _count?: boolean | SessionCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type SessionIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    build?: boolean | Session$buildArgs<ExtArgs>
  }

  export type $SessionPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Session"
    objects: {
      Log: Prisma.$LogPayload<ExtArgs>[]
      Profiling: Prisma.$ProfilingPayload<ExtArgs>[]
      build: Prisma.$BuildPayload<ExtArgs> | null
      SessionLog: Prisma.$SessionLogPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      build_id: string | null
      name: string | null
      status: string
      desired_capabilities: string
      session_capabilities: string
      node_id: string
      has_live_video: boolean
      video_recording_enabled: boolean
      video_recording: string | null
      startTime: Date
      endTime: Date | null
      failure_reason: string | null
      is_profiling_available: boolean
      device_info: string | null
      device_udid: string
      device_platform: string
      device_version: string
      device_name: string | null
      createdAt: Date
      updatedAt: Date
      performance_trace: string | null
      failure_category: string | null
      ai_analysis: string | null
      tags: string | null
      trace_id: string | null
      last_heartbeat_at: Date | null
      heartbeat_pid: number | null
      heartbeat_host: string | null
    }, ExtArgs["result"]["session"]>
    composites: {}
  }

  type SessionGetPayload<S extends boolean | null | undefined | SessionDefaultArgs> = $Result.GetResult<Prisma.$SessionPayload, S>

  type SessionCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<SessionFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: SessionCountAggregateInputType | true
    }

  export interface SessionDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Session'], meta: { name: 'Session' } }
    /**
     * Find zero or one Session that matches the filter.
     * @param {SessionFindUniqueArgs} args - Arguments to find a Session
     * @example
     * // Get one Session
     * const session = await prisma.session.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends SessionFindUniqueArgs>(args: SelectSubset<T, SessionFindUniqueArgs<ExtArgs>>): Prisma__SessionClient<$Result.GetResult<Prisma.$SessionPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Session that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {SessionFindUniqueOrThrowArgs} args - Arguments to find a Session
     * @example
     * // Get one Session
     * const session = await prisma.session.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends SessionFindUniqueOrThrowArgs>(args: SelectSubset<T, SessionFindUniqueOrThrowArgs<ExtArgs>>): Prisma__SessionClient<$Result.GetResult<Prisma.$SessionPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Session that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SessionFindFirstArgs} args - Arguments to find a Session
     * @example
     * // Get one Session
     * const session = await prisma.session.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends SessionFindFirstArgs>(args?: SelectSubset<T, SessionFindFirstArgs<ExtArgs>>): Prisma__SessionClient<$Result.GetResult<Prisma.$SessionPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Session that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SessionFindFirstOrThrowArgs} args - Arguments to find a Session
     * @example
     * // Get one Session
     * const session = await prisma.session.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends SessionFindFirstOrThrowArgs>(args?: SelectSubset<T, SessionFindFirstOrThrowArgs<ExtArgs>>): Prisma__SessionClient<$Result.GetResult<Prisma.$SessionPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Sessions that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SessionFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Sessions
     * const sessions = await prisma.session.findMany()
     * 
     * // Get first 10 Sessions
     * const sessions = await prisma.session.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const sessionWithIdOnly = await prisma.session.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends SessionFindManyArgs>(args?: SelectSubset<T, SessionFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$SessionPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Session.
     * @param {SessionCreateArgs} args - Arguments to create a Session.
     * @example
     * // Create one Session
     * const Session = await prisma.session.create({
     *   data: {
     *     // ... data to create a Session
     *   }
     * })
     * 
     */
    create<T extends SessionCreateArgs>(args: SelectSubset<T, SessionCreateArgs<ExtArgs>>): Prisma__SessionClient<$Result.GetResult<Prisma.$SessionPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Sessions.
     * @param {SessionCreateManyArgs} args - Arguments to create many Sessions.
     * @example
     * // Create many Sessions
     * const session = await prisma.session.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends SessionCreateManyArgs>(args?: SelectSubset<T, SessionCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Sessions and returns the data saved in the database.
     * @param {SessionCreateManyAndReturnArgs} args - Arguments to create many Sessions.
     * @example
     * // Create many Sessions
     * const session = await prisma.session.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Sessions and only return the `id`
     * const sessionWithIdOnly = await prisma.session.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends SessionCreateManyAndReturnArgs>(args?: SelectSubset<T, SessionCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$SessionPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Session.
     * @param {SessionDeleteArgs} args - Arguments to delete one Session.
     * @example
     * // Delete one Session
     * const Session = await prisma.session.delete({
     *   where: {
     *     // ... filter to delete one Session
     *   }
     * })
     * 
     */
    delete<T extends SessionDeleteArgs>(args: SelectSubset<T, SessionDeleteArgs<ExtArgs>>): Prisma__SessionClient<$Result.GetResult<Prisma.$SessionPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Session.
     * @param {SessionUpdateArgs} args - Arguments to update one Session.
     * @example
     * // Update one Session
     * const session = await prisma.session.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends SessionUpdateArgs>(args: SelectSubset<T, SessionUpdateArgs<ExtArgs>>): Prisma__SessionClient<$Result.GetResult<Prisma.$SessionPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Sessions.
     * @param {SessionDeleteManyArgs} args - Arguments to filter Sessions to delete.
     * @example
     * // Delete a few Sessions
     * const { count } = await prisma.session.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends SessionDeleteManyArgs>(args?: SelectSubset<T, SessionDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Sessions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SessionUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Sessions
     * const session = await prisma.session.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends SessionUpdateManyArgs>(args: SelectSubset<T, SessionUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Session.
     * @param {SessionUpsertArgs} args - Arguments to update or create a Session.
     * @example
     * // Update or create a Session
     * const session = await prisma.session.upsert({
     *   create: {
     *     // ... data to create a Session
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Session we want to update
     *   }
     * })
     */
    upsert<T extends SessionUpsertArgs>(args: SelectSubset<T, SessionUpsertArgs<ExtArgs>>): Prisma__SessionClient<$Result.GetResult<Prisma.$SessionPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Sessions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SessionCountArgs} args - Arguments to filter Sessions to count.
     * @example
     * // Count the number of Sessions
     * const count = await prisma.session.count({
     *   where: {
     *     // ... the filter for the Sessions we want to count
     *   }
     * })
    **/
    count<T extends SessionCountArgs>(
      args?: Subset<T, SessionCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], SessionCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Session.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SessionAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends SessionAggregateArgs>(args: Subset<T, SessionAggregateArgs>): Prisma.PrismaPromise<GetSessionAggregateType<T>>

    /**
     * Group by Session.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SessionGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends SessionGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: SessionGroupByArgs['orderBy'] }
        : { orderBy?: SessionGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, SessionGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetSessionGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Session model
   */
  readonly fields: SessionFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Session.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__SessionClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    Log<T extends Session$LogArgs<ExtArgs> = {}>(args?: Subset<T, Session$LogArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$LogPayload<ExtArgs>, T, "findMany"> | Null>
    Profiling<T extends Session$ProfilingArgs<ExtArgs> = {}>(args?: Subset<T, Session$ProfilingArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ProfilingPayload<ExtArgs>, T, "findMany"> | Null>
    build<T extends Session$buildArgs<ExtArgs> = {}>(args?: Subset<T, Session$buildArgs<ExtArgs>>): Prisma__BuildClient<$Result.GetResult<Prisma.$BuildPayload<ExtArgs>, T, "findUniqueOrThrow"> | null, null, ExtArgs>
    SessionLog<T extends Session$SessionLogArgs<ExtArgs> = {}>(args?: Subset<T, Session$SessionLogArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$SessionLogPayload<ExtArgs>, T, "findMany"> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Session model
   */ 
  interface SessionFieldRefs {
    readonly id: FieldRef<"Session", 'String'>
    readonly build_id: FieldRef<"Session", 'String'>
    readonly name: FieldRef<"Session", 'String'>
    readonly status: FieldRef<"Session", 'String'>
    readonly desired_capabilities: FieldRef<"Session", 'String'>
    readonly session_capabilities: FieldRef<"Session", 'String'>
    readonly node_id: FieldRef<"Session", 'String'>
    readonly has_live_video: FieldRef<"Session", 'Boolean'>
    readonly video_recording_enabled: FieldRef<"Session", 'Boolean'>
    readonly video_recording: FieldRef<"Session", 'String'>
    readonly startTime: FieldRef<"Session", 'DateTime'>
    readonly endTime: FieldRef<"Session", 'DateTime'>
    readonly failure_reason: FieldRef<"Session", 'String'>
    readonly is_profiling_available: FieldRef<"Session", 'Boolean'>
    readonly device_info: FieldRef<"Session", 'String'>
    readonly device_udid: FieldRef<"Session", 'String'>
    readonly device_platform: FieldRef<"Session", 'String'>
    readonly device_version: FieldRef<"Session", 'String'>
    readonly device_name: FieldRef<"Session", 'String'>
    readonly createdAt: FieldRef<"Session", 'DateTime'>
    readonly updatedAt: FieldRef<"Session", 'DateTime'>
    readonly performance_trace: FieldRef<"Session", 'String'>
    readonly failure_category: FieldRef<"Session", 'String'>
    readonly ai_analysis: FieldRef<"Session", 'String'>
    readonly tags: FieldRef<"Session", 'String'>
    readonly trace_id: FieldRef<"Session", 'String'>
    readonly last_heartbeat_at: FieldRef<"Session", 'DateTime'>
    readonly heartbeat_pid: FieldRef<"Session", 'Int'>
    readonly heartbeat_host: FieldRef<"Session", 'String'>
  }
    

  // Custom InputTypes
  /**
   * Session findUnique
   */
  export type SessionFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Session
     */
    select?: SessionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SessionInclude<ExtArgs> | null
    /**
     * Filter, which Session to fetch.
     */
    where: SessionWhereUniqueInput
  }

  /**
   * Session findUniqueOrThrow
   */
  export type SessionFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Session
     */
    select?: SessionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SessionInclude<ExtArgs> | null
    /**
     * Filter, which Session to fetch.
     */
    where: SessionWhereUniqueInput
  }

  /**
   * Session findFirst
   */
  export type SessionFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Session
     */
    select?: SessionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SessionInclude<ExtArgs> | null
    /**
     * Filter, which Session to fetch.
     */
    where?: SessionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Sessions to fetch.
     */
    orderBy?: SessionOrderByWithRelationInput | SessionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Sessions.
     */
    cursor?: SessionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Sessions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Sessions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Sessions.
     */
    distinct?: SessionScalarFieldEnum | SessionScalarFieldEnum[]
  }

  /**
   * Session findFirstOrThrow
   */
  export type SessionFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Session
     */
    select?: SessionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SessionInclude<ExtArgs> | null
    /**
     * Filter, which Session to fetch.
     */
    where?: SessionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Sessions to fetch.
     */
    orderBy?: SessionOrderByWithRelationInput | SessionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Sessions.
     */
    cursor?: SessionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Sessions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Sessions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Sessions.
     */
    distinct?: SessionScalarFieldEnum | SessionScalarFieldEnum[]
  }

  /**
   * Session findMany
   */
  export type SessionFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Session
     */
    select?: SessionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SessionInclude<ExtArgs> | null
    /**
     * Filter, which Sessions to fetch.
     */
    where?: SessionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Sessions to fetch.
     */
    orderBy?: SessionOrderByWithRelationInput | SessionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Sessions.
     */
    cursor?: SessionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Sessions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Sessions.
     */
    skip?: number
    distinct?: SessionScalarFieldEnum | SessionScalarFieldEnum[]
  }

  /**
   * Session create
   */
  export type SessionCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Session
     */
    select?: SessionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SessionInclude<ExtArgs> | null
    /**
     * The data needed to create a Session.
     */
    data: XOR<SessionCreateInput, SessionUncheckedCreateInput>
  }

  /**
   * Session createMany
   */
  export type SessionCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Sessions.
     */
    data: SessionCreateManyInput | SessionCreateManyInput[]
  }

  /**
   * Session createManyAndReturn
   */
  export type SessionCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Session
     */
    select?: SessionSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many Sessions.
     */
    data: SessionCreateManyInput | SessionCreateManyInput[]
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SessionIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * Session update
   */
  export type SessionUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Session
     */
    select?: SessionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SessionInclude<ExtArgs> | null
    /**
     * The data needed to update a Session.
     */
    data: XOR<SessionUpdateInput, SessionUncheckedUpdateInput>
    /**
     * Choose, which Session to update.
     */
    where: SessionWhereUniqueInput
  }

  /**
   * Session updateMany
   */
  export type SessionUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Sessions.
     */
    data: XOR<SessionUpdateManyMutationInput, SessionUncheckedUpdateManyInput>
    /**
     * Filter which Sessions to update
     */
    where?: SessionWhereInput
  }

  /**
   * Session upsert
   */
  export type SessionUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Session
     */
    select?: SessionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SessionInclude<ExtArgs> | null
    /**
     * The filter to search for the Session to update in case it exists.
     */
    where: SessionWhereUniqueInput
    /**
     * In case the Session found by the `where` argument doesn't exist, create a new Session with this data.
     */
    create: XOR<SessionCreateInput, SessionUncheckedCreateInput>
    /**
     * In case the Session was found with the provided `where` argument, update it with this data.
     */
    update: XOR<SessionUpdateInput, SessionUncheckedUpdateInput>
  }

  /**
   * Session delete
   */
  export type SessionDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Session
     */
    select?: SessionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SessionInclude<ExtArgs> | null
    /**
     * Filter which Session to delete.
     */
    where: SessionWhereUniqueInput
  }

  /**
   * Session deleteMany
   */
  export type SessionDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Sessions to delete
     */
    where?: SessionWhereInput
  }

  /**
   * Session.Log
   */
  export type Session$LogArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Log
     */
    select?: LogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: LogInclude<ExtArgs> | null
    where?: LogWhereInput
    orderBy?: LogOrderByWithRelationInput | LogOrderByWithRelationInput[]
    cursor?: LogWhereUniqueInput
    take?: number
    skip?: number
    distinct?: LogScalarFieldEnum | LogScalarFieldEnum[]
  }

  /**
   * Session.Profiling
   */
  export type Session$ProfilingArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Profiling
     */
    select?: ProfilingSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ProfilingInclude<ExtArgs> | null
    where?: ProfilingWhereInput
    orderBy?: ProfilingOrderByWithRelationInput | ProfilingOrderByWithRelationInput[]
    cursor?: ProfilingWhereUniqueInput
    take?: number
    skip?: number
    distinct?: ProfilingScalarFieldEnum | ProfilingScalarFieldEnum[]
  }

  /**
   * Session.build
   */
  export type Session$buildArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Build
     */
    select?: BuildSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: BuildInclude<ExtArgs> | null
    where?: BuildWhereInput
  }

  /**
   * Session.SessionLog
   */
  export type Session$SessionLogArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SessionLog
     */
    select?: SessionLogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SessionLogInclude<ExtArgs> | null
    where?: SessionLogWhereInput
    orderBy?: SessionLogOrderByWithRelationInput | SessionLogOrderByWithRelationInput[]
    cursor?: SessionLogWhereUniqueInput
    take?: number
    skip?: number
    distinct?: SessionLogScalarFieldEnum | SessionLogScalarFieldEnum[]
  }

  /**
   * Session without action
   */
  export type SessionDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Session
     */
    select?: SessionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SessionInclude<ExtArgs> | null
  }


  /**
   * Model SessionLog
   */

  export type AggregateSessionLog = {
    _count: SessionLogCountAggregateOutputType | null
    _avg: SessionLogAvgAggregateOutputType | null
    _sum: SessionLogSumAggregateOutputType | null
    _min: SessionLogMinAggregateOutputType | null
    _max: SessionLogMaxAggregateOutputType | null
  }

  export type SessionLogAvgAggregateOutputType = {
    healing_confidence: number | null
    duration: number | null
  }

  export type SessionLogSumAggregateOutputType = {
    healing_confidence: number | null
    duration: number | null
  }

  export type SessionLogMinAggregateOutputType = {
    id: string | null
    session_id: string | null
    command_name: string | null
    url: string | null
    method: string | null
    title: string | null
    subtitle: string | null
    body: string | null
    response: string | null
    screenshot: string | null
    is_success: boolean | null
    is_error: boolean | null
    is_healed: boolean | null
    original_selector: string | null
    healed_selector: string | null
    healing_confidence: number | null
    createdAt: Date | null
    updatedAt: Date | null
    duration: number | null
    span_id: string | null
    trace_id: string | null
  }

  export type SessionLogMaxAggregateOutputType = {
    id: string | null
    session_id: string | null
    command_name: string | null
    url: string | null
    method: string | null
    title: string | null
    subtitle: string | null
    body: string | null
    response: string | null
    screenshot: string | null
    is_success: boolean | null
    is_error: boolean | null
    is_healed: boolean | null
    original_selector: string | null
    healed_selector: string | null
    healing_confidence: number | null
    createdAt: Date | null
    updatedAt: Date | null
    duration: number | null
    span_id: string | null
    trace_id: string | null
  }

  export type SessionLogCountAggregateOutputType = {
    id: number
    session_id: number
    command_name: number
    url: number
    method: number
    title: number
    subtitle: number
    body: number
    response: number
    screenshot: number
    is_success: number
    is_error: number
    is_healed: number
    original_selector: number
    healed_selector: number
    healing_confidence: number
    createdAt: number
    updatedAt: number
    duration: number
    span_id: number
    trace_id: number
    _all: number
  }


  export type SessionLogAvgAggregateInputType = {
    healing_confidence?: true
    duration?: true
  }

  export type SessionLogSumAggregateInputType = {
    healing_confidence?: true
    duration?: true
  }

  export type SessionLogMinAggregateInputType = {
    id?: true
    session_id?: true
    command_name?: true
    url?: true
    method?: true
    title?: true
    subtitle?: true
    body?: true
    response?: true
    screenshot?: true
    is_success?: true
    is_error?: true
    is_healed?: true
    original_selector?: true
    healed_selector?: true
    healing_confidence?: true
    createdAt?: true
    updatedAt?: true
    duration?: true
    span_id?: true
    trace_id?: true
  }

  export type SessionLogMaxAggregateInputType = {
    id?: true
    session_id?: true
    command_name?: true
    url?: true
    method?: true
    title?: true
    subtitle?: true
    body?: true
    response?: true
    screenshot?: true
    is_success?: true
    is_error?: true
    is_healed?: true
    original_selector?: true
    healed_selector?: true
    healing_confidence?: true
    createdAt?: true
    updatedAt?: true
    duration?: true
    span_id?: true
    trace_id?: true
  }

  export type SessionLogCountAggregateInputType = {
    id?: true
    session_id?: true
    command_name?: true
    url?: true
    method?: true
    title?: true
    subtitle?: true
    body?: true
    response?: true
    screenshot?: true
    is_success?: true
    is_error?: true
    is_healed?: true
    original_selector?: true
    healed_selector?: true
    healing_confidence?: true
    createdAt?: true
    updatedAt?: true
    duration?: true
    span_id?: true
    trace_id?: true
    _all?: true
  }

  export type SessionLogAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which SessionLog to aggregate.
     */
    where?: SessionLogWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of SessionLogs to fetch.
     */
    orderBy?: SessionLogOrderByWithRelationInput | SessionLogOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: SessionLogWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` SessionLogs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` SessionLogs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned SessionLogs
    **/
    _count?: true | SessionLogCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: SessionLogAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: SessionLogSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: SessionLogMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: SessionLogMaxAggregateInputType
  }

  export type GetSessionLogAggregateType<T extends SessionLogAggregateArgs> = {
        [P in keyof T & keyof AggregateSessionLog]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateSessionLog[P]>
      : GetScalarType<T[P], AggregateSessionLog[P]>
  }




  export type SessionLogGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: SessionLogWhereInput
    orderBy?: SessionLogOrderByWithAggregationInput | SessionLogOrderByWithAggregationInput[]
    by: SessionLogScalarFieldEnum[] | SessionLogScalarFieldEnum
    having?: SessionLogScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: SessionLogCountAggregateInputType | true
    _avg?: SessionLogAvgAggregateInputType
    _sum?: SessionLogSumAggregateInputType
    _min?: SessionLogMinAggregateInputType
    _max?: SessionLogMaxAggregateInputType
  }

  export type SessionLogGroupByOutputType = {
    id: string
    session_id: string
    command_name: string | null
    url: string
    method: string
    title: string
    subtitle: string | null
    body: string | null
    response: string
    screenshot: string | null
    is_success: boolean | null
    is_error: boolean
    is_healed: boolean
    original_selector: string | null
    healed_selector: string | null
    healing_confidence: number | null
    createdAt: Date
    updatedAt: Date
    duration: number | null
    span_id: string | null
    trace_id: string | null
    _count: SessionLogCountAggregateOutputType | null
    _avg: SessionLogAvgAggregateOutputType | null
    _sum: SessionLogSumAggregateOutputType | null
    _min: SessionLogMinAggregateOutputType | null
    _max: SessionLogMaxAggregateOutputType | null
  }

  type GetSessionLogGroupByPayload<T extends SessionLogGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<SessionLogGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof SessionLogGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], SessionLogGroupByOutputType[P]>
            : GetScalarType<T[P], SessionLogGroupByOutputType[P]>
        }
      >
    >


  export type SessionLogSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    session_id?: boolean
    command_name?: boolean
    url?: boolean
    method?: boolean
    title?: boolean
    subtitle?: boolean
    body?: boolean
    response?: boolean
    screenshot?: boolean
    is_success?: boolean
    is_error?: boolean
    is_healed?: boolean
    original_selector?: boolean
    healed_selector?: boolean
    healing_confidence?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    duration?: boolean
    span_id?: boolean
    trace_id?: boolean
    session?: boolean | SessionDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["sessionLog"]>

  export type SessionLogSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    session_id?: boolean
    command_name?: boolean
    url?: boolean
    method?: boolean
    title?: boolean
    subtitle?: boolean
    body?: boolean
    response?: boolean
    screenshot?: boolean
    is_success?: boolean
    is_error?: boolean
    is_healed?: boolean
    original_selector?: boolean
    healed_selector?: boolean
    healing_confidence?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    duration?: boolean
    span_id?: boolean
    trace_id?: boolean
    session?: boolean | SessionDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["sessionLog"]>

  export type SessionLogSelectScalar = {
    id?: boolean
    session_id?: boolean
    command_name?: boolean
    url?: boolean
    method?: boolean
    title?: boolean
    subtitle?: boolean
    body?: boolean
    response?: boolean
    screenshot?: boolean
    is_success?: boolean
    is_error?: boolean
    is_healed?: boolean
    original_selector?: boolean
    healed_selector?: boolean
    healing_confidence?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    duration?: boolean
    span_id?: boolean
    trace_id?: boolean
  }

  export type SessionLogInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    session?: boolean | SessionDefaultArgs<ExtArgs>
  }
  export type SessionLogIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    session?: boolean | SessionDefaultArgs<ExtArgs>
  }

  export type $SessionLogPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "SessionLog"
    objects: {
      session: Prisma.$SessionPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      session_id: string
      command_name: string | null
      url: string
      method: string
      title: string
      subtitle: string | null
      body: string | null
      response: string
      screenshot: string | null
      is_success: boolean | null
      is_error: boolean
      is_healed: boolean
      original_selector: string | null
      healed_selector: string | null
      healing_confidence: number | null
      createdAt: Date
      updatedAt: Date
      duration: number | null
      span_id: string | null
      trace_id: string | null
    }, ExtArgs["result"]["sessionLog"]>
    composites: {}
  }

  type SessionLogGetPayload<S extends boolean | null | undefined | SessionLogDefaultArgs> = $Result.GetResult<Prisma.$SessionLogPayload, S>

  type SessionLogCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<SessionLogFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: SessionLogCountAggregateInputType | true
    }

  export interface SessionLogDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['SessionLog'], meta: { name: 'SessionLog' } }
    /**
     * Find zero or one SessionLog that matches the filter.
     * @param {SessionLogFindUniqueArgs} args - Arguments to find a SessionLog
     * @example
     * // Get one SessionLog
     * const sessionLog = await prisma.sessionLog.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends SessionLogFindUniqueArgs>(args: SelectSubset<T, SessionLogFindUniqueArgs<ExtArgs>>): Prisma__SessionLogClient<$Result.GetResult<Prisma.$SessionLogPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one SessionLog that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {SessionLogFindUniqueOrThrowArgs} args - Arguments to find a SessionLog
     * @example
     * // Get one SessionLog
     * const sessionLog = await prisma.sessionLog.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends SessionLogFindUniqueOrThrowArgs>(args: SelectSubset<T, SessionLogFindUniqueOrThrowArgs<ExtArgs>>): Prisma__SessionLogClient<$Result.GetResult<Prisma.$SessionLogPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first SessionLog that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SessionLogFindFirstArgs} args - Arguments to find a SessionLog
     * @example
     * // Get one SessionLog
     * const sessionLog = await prisma.sessionLog.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends SessionLogFindFirstArgs>(args?: SelectSubset<T, SessionLogFindFirstArgs<ExtArgs>>): Prisma__SessionLogClient<$Result.GetResult<Prisma.$SessionLogPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first SessionLog that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SessionLogFindFirstOrThrowArgs} args - Arguments to find a SessionLog
     * @example
     * // Get one SessionLog
     * const sessionLog = await prisma.sessionLog.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends SessionLogFindFirstOrThrowArgs>(args?: SelectSubset<T, SessionLogFindFirstOrThrowArgs<ExtArgs>>): Prisma__SessionLogClient<$Result.GetResult<Prisma.$SessionLogPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more SessionLogs that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SessionLogFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all SessionLogs
     * const sessionLogs = await prisma.sessionLog.findMany()
     * 
     * // Get first 10 SessionLogs
     * const sessionLogs = await prisma.sessionLog.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const sessionLogWithIdOnly = await prisma.sessionLog.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends SessionLogFindManyArgs>(args?: SelectSubset<T, SessionLogFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$SessionLogPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a SessionLog.
     * @param {SessionLogCreateArgs} args - Arguments to create a SessionLog.
     * @example
     * // Create one SessionLog
     * const SessionLog = await prisma.sessionLog.create({
     *   data: {
     *     // ... data to create a SessionLog
     *   }
     * })
     * 
     */
    create<T extends SessionLogCreateArgs>(args: SelectSubset<T, SessionLogCreateArgs<ExtArgs>>): Prisma__SessionLogClient<$Result.GetResult<Prisma.$SessionLogPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many SessionLogs.
     * @param {SessionLogCreateManyArgs} args - Arguments to create many SessionLogs.
     * @example
     * // Create many SessionLogs
     * const sessionLog = await prisma.sessionLog.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends SessionLogCreateManyArgs>(args?: SelectSubset<T, SessionLogCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many SessionLogs and returns the data saved in the database.
     * @param {SessionLogCreateManyAndReturnArgs} args - Arguments to create many SessionLogs.
     * @example
     * // Create many SessionLogs
     * const sessionLog = await prisma.sessionLog.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many SessionLogs and only return the `id`
     * const sessionLogWithIdOnly = await prisma.sessionLog.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends SessionLogCreateManyAndReturnArgs>(args?: SelectSubset<T, SessionLogCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$SessionLogPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a SessionLog.
     * @param {SessionLogDeleteArgs} args - Arguments to delete one SessionLog.
     * @example
     * // Delete one SessionLog
     * const SessionLog = await prisma.sessionLog.delete({
     *   where: {
     *     // ... filter to delete one SessionLog
     *   }
     * })
     * 
     */
    delete<T extends SessionLogDeleteArgs>(args: SelectSubset<T, SessionLogDeleteArgs<ExtArgs>>): Prisma__SessionLogClient<$Result.GetResult<Prisma.$SessionLogPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one SessionLog.
     * @param {SessionLogUpdateArgs} args - Arguments to update one SessionLog.
     * @example
     * // Update one SessionLog
     * const sessionLog = await prisma.sessionLog.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends SessionLogUpdateArgs>(args: SelectSubset<T, SessionLogUpdateArgs<ExtArgs>>): Prisma__SessionLogClient<$Result.GetResult<Prisma.$SessionLogPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more SessionLogs.
     * @param {SessionLogDeleteManyArgs} args - Arguments to filter SessionLogs to delete.
     * @example
     * // Delete a few SessionLogs
     * const { count } = await prisma.sessionLog.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends SessionLogDeleteManyArgs>(args?: SelectSubset<T, SessionLogDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more SessionLogs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SessionLogUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many SessionLogs
     * const sessionLog = await prisma.sessionLog.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends SessionLogUpdateManyArgs>(args: SelectSubset<T, SessionLogUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one SessionLog.
     * @param {SessionLogUpsertArgs} args - Arguments to update or create a SessionLog.
     * @example
     * // Update or create a SessionLog
     * const sessionLog = await prisma.sessionLog.upsert({
     *   create: {
     *     // ... data to create a SessionLog
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the SessionLog we want to update
     *   }
     * })
     */
    upsert<T extends SessionLogUpsertArgs>(args: SelectSubset<T, SessionLogUpsertArgs<ExtArgs>>): Prisma__SessionLogClient<$Result.GetResult<Prisma.$SessionLogPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of SessionLogs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SessionLogCountArgs} args - Arguments to filter SessionLogs to count.
     * @example
     * // Count the number of SessionLogs
     * const count = await prisma.sessionLog.count({
     *   where: {
     *     // ... the filter for the SessionLogs we want to count
     *   }
     * })
    **/
    count<T extends SessionLogCountArgs>(
      args?: Subset<T, SessionLogCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], SessionLogCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a SessionLog.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SessionLogAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends SessionLogAggregateArgs>(args: Subset<T, SessionLogAggregateArgs>): Prisma.PrismaPromise<GetSessionLogAggregateType<T>>

    /**
     * Group by SessionLog.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SessionLogGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends SessionLogGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: SessionLogGroupByArgs['orderBy'] }
        : { orderBy?: SessionLogGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, SessionLogGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetSessionLogGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the SessionLog model
   */
  readonly fields: SessionLogFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for SessionLog.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__SessionLogClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    session<T extends SessionDefaultArgs<ExtArgs> = {}>(args?: Subset<T, SessionDefaultArgs<ExtArgs>>): Prisma__SessionClient<$Result.GetResult<Prisma.$SessionPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the SessionLog model
   */ 
  interface SessionLogFieldRefs {
    readonly id: FieldRef<"SessionLog", 'String'>
    readonly session_id: FieldRef<"SessionLog", 'String'>
    readonly command_name: FieldRef<"SessionLog", 'String'>
    readonly url: FieldRef<"SessionLog", 'String'>
    readonly method: FieldRef<"SessionLog", 'String'>
    readonly title: FieldRef<"SessionLog", 'String'>
    readonly subtitle: FieldRef<"SessionLog", 'String'>
    readonly body: FieldRef<"SessionLog", 'String'>
    readonly response: FieldRef<"SessionLog", 'String'>
    readonly screenshot: FieldRef<"SessionLog", 'String'>
    readonly is_success: FieldRef<"SessionLog", 'Boolean'>
    readonly is_error: FieldRef<"SessionLog", 'Boolean'>
    readonly is_healed: FieldRef<"SessionLog", 'Boolean'>
    readonly original_selector: FieldRef<"SessionLog", 'String'>
    readonly healed_selector: FieldRef<"SessionLog", 'String'>
    readonly healing_confidence: FieldRef<"SessionLog", 'Float'>
    readonly createdAt: FieldRef<"SessionLog", 'DateTime'>
    readonly updatedAt: FieldRef<"SessionLog", 'DateTime'>
    readonly duration: FieldRef<"SessionLog", 'Int'>
    readonly span_id: FieldRef<"SessionLog", 'String'>
    readonly trace_id: FieldRef<"SessionLog", 'String'>
  }
    

  // Custom InputTypes
  /**
   * SessionLog findUnique
   */
  export type SessionLogFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SessionLog
     */
    select?: SessionLogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SessionLogInclude<ExtArgs> | null
    /**
     * Filter, which SessionLog to fetch.
     */
    where: SessionLogWhereUniqueInput
  }

  /**
   * SessionLog findUniqueOrThrow
   */
  export type SessionLogFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SessionLog
     */
    select?: SessionLogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SessionLogInclude<ExtArgs> | null
    /**
     * Filter, which SessionLog to fetch.
     */
    where: SessionLogWhereUniqueInput
  }

  /**
   * SessionLog findFirst
   */
  export type SessionLogFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SessionLog
     */
    select?: SessionLogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SessionLogInclude<ExtArgs> | null
    /**
     * Filter, which SessionLog to fetch.
     */
    where?: SessionLogWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of SessionLogs to fetch.
     */
    orderBy?: SessionLogOrderByWithRelationInput | SessionLogOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for SessionLogs.
     */
    cursor?: SessionLogWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` SessionLogs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` SessionLogs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of SessionLogs.
     */
    distinct?: SessionLogScalarFieldEnum | SessionLogScalarFieldEnum[]
  }

  /**
   * SessionLog findFirstOrThrow
   */
  export type SessionLogFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SessionLog
     */
    select?: SessionLogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SessionLogInclude<ExtArgs> | null
    /**
     * Filter, which SessionLog to fetch.
     */
    where?: SessionLogWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of SessionLogs to fetch.
     */
    orderBy?: SessionLogOrderByWithRelationInput | SessionLogOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for SessionLogs.
     */
    cursor?: SessionLogWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` SessionLogs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` SessionLogs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of SessionLogs.
     */
    distinct?: SessionLogScalarFieldEnum | SessionLogScalarFieldEnum[]
  }

  /**
   * SessionLog findMany
   */
  export type SessionLogFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SessionLog
     */
    select?: SessionLogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SessionLogInclude<ExtArgs> | null
    /**
     * Filter, which SessionLogs to fetch.
     */
    where?: SessionLogWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of SessionLogs to fetch.
     */
    orderBy?: SessionLogOrderByWithRelationInput | SessionLogOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing SessionLogs.
     */
    cursor?: SessionLogWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` SessionLogs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` SessionLogs.
     */
    skip?: number
    distinct?: SessionLogScalarFieldEnum | SessionLogScalarFieldEnum[]
  }

  /**
   * SessionLog create
   */
  export type SessionLogCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SessionLog
     */
    select?: SessionLogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SessionLogInclude<ExtArgs> | null
    /**
     * The data needed to create a SessionLog.
     */
    data: XOR<SessionLogCreateInput, SessionLogUncheckedCreateInput>
  }

  /**
   * SessionLog createMany
   */
  export type SessionLogCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many SessionLogs.
     */
    data: SessionLogCreateManyInput | SessionLogCreateManyInput[]
  }

  /**
   * SessionLog createManyAndReturn
   */
  export type SessionLogCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SessionLog
     */
    select?: SessionLogSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many SessionLogs.
     */
    data: SessionLogCreateManyInput | SessionLogCreateManyInput[]
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SessionLogIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * SessionLog update
   */
  export type SessionLogUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SessionLog
     */
    select?: SessionLogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SessionLogInclude<ExtArgs> | null
    /**
     * The data needed to update a SessionLog.
     */
    data: XOR<SessionLogUpdateInput, SessionLogUncheckedUpdateInput>
    /**
     * Choose, which SessionLog to update.
     */
    where: SessionLogWhereUniqueInput
  }

  /**
   * SessionLog updateMany
   */
  export type SessionLogUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update SessionLogs.
     */
    data: XOR<SessionLogUpdateManyMutationInput, SessionLogUncheckedUpdateManyInput>
    /**
     * Filter which SessionLogs to update
     */
    where?: SessionLogWhereInput
  }

  /**
   * SessionLog upsert
   */
  export type SessionLogUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SessionLog
     */
    select?: SessionLogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SessionLogInclude<ExtArgs> | null
    /**
     * The filter to search for the SessionLog to update in case it exists.
     */
    where: SessionLogWhereUniqueInput
    /**
     * In case the SessionLog found by the `where` argument doesn't exist, create a new SessionLog with this data.
     */
    create: XOR<SessionLogCreateInput, SessionLogUncheckedCreateInput>
    /**
     * In case the SessionLog was found with the provided `where` argument, update it with this data.
     */
    update: XOR<SessionLogUpdateInput, SessionLogUncheckedUpdateInput>
  }

  /**
   * SessionLog delete
   */
  export type SessionLogDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SessionLog
     */
    select?: SessionLogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SessionLogInclude<ExtArgs> | null
    /**
     * Filter which SessionLog to delete.
     */
    where: SessionLogWhereUniqueInput
  }

  /**
   * SessionLog deleteMany
   */
  export type SessionLogDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which SessionLogs to delete
     */
    where?: SessionLogWhereInput
  }

  /**
   * SessionLog without action
   */
  export type SessionLogDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SessionLog
     */
    select?: SessionLogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SessionLogInclude<ExtArgs> | null
  }


  /**
   * Model Log
   */

  export type AggregateLog = {
    _count: LogCountAggregateOutputType | null
    _min: LogMinAggregateOutputType | null
    _max: LogMaxAggregateOutputType | null
  }

  export type LogMinAggregateOutputType = {
    id: string | null
    session_id: string | null
    log_type: string | null
    message: string | null
    timestamp: Date | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type LogMaxAggregateOutputType = {
    id: string | null
    session_id: string | null
    log_type: string | null
    message: string | null
    timestamp: Date | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type LogCountAggregateOutputType = {
    id: number
    session_id: number
    log_type: number
    message: number
    timestamp: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type LogMinAggregateInputType = {
    id?: true
    session_id?: true
    log_type?: true
    message?: true
    timestamp?: true
    createdAt?: true
    updatedAt?: true
  }

  export type LogMaxAggregateInputType = {
    id?: true
    session_id?: true
    log_type?: true
    message?: true
    timestamp?: true
    createdAt?: true
    updatedAt?: true
  }

  export type LogCountAggregateInputType = {
    id?: true
    session_id?: true
    log_type?: true
    message?: true
    timestamp?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type LogAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Log to aggregate.
     */
    where?: LogWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Logs to fetch.
     */
    orderBy?: LogOrderByWithRelationInput | LogOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: LogWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Logs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Logs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Logs
    **/
    _count?: true | LogCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: LogMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: LogMaxAggregateInputType
  }

  export type GetLogAggregateType<T extends LogAggregateArgs> = {
        [P in keyof T & keyof AggregateLog]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateLog[P]>
      : GetScalarType<T[P], AggregateLog[P]>
  }




  export type LogGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: LogWhereInput
    orderBy?: LogOrderByWithAggregationInput | LogOrderByWithAggregationInput[]
    by: LogScalarFieldEnum[] | LogScalarFieldEnum
    having?: LogScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: LogCountAggregateInputType | true
    _min?: LogMinAggregateInputType
    _max?: LogMaxAggregateInputType
  }

  export type LogGroupByOutputType = {
    id: string
    session_id: string
    log_type: string
    message: string
    timestamp: Date
    createdAt: Date
    updatedAt: Date
    _count: LogCountAggregateOutputType | null
    _min: LogMinAggregateOutputType | null
    _max: LogMaxAggregateOutputType | null
  }

  type GetLogGroupByPayload<T extends LogGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<LogGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof LogGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], LogGroupByOutputType[P]>
            : GetScalarType<T[P], LogGroupByOutputType[P]>
        }
      >
    >


  export type LogSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    session_id?: boolean
    log_type?: boolean
    message?: boolean
    timestamp?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    session?: boolean | SessionDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["log"]>

  export type LogSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    session_id?: boolean
    log_type?: boolean
    message?: boolean
    timestamp?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    session?: boolean | SessionDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["log"]>

  export type LogSelectScalar = {
    id?: boolean
    session_id?: boolean
    log_type?: boolean
    message?: boolean
    timestamp?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type LogInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    session?: boolean | SessionDefaultArgs<ExtArgs>
  }
  export type LogIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    session?: boolean | SessionDefaultArgs<ExtArgs>
  }

  export type $LogPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Log"
    objects: {
      session: Prisma.$SessionPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      session_id: string
      log_type: string
      message: string
      timestamp: Date
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["log"]>
    composites: {}
  }

  type LogGetPayload<S extends boolean | null | undefined | LogDefaultArgs> = $Result.GetResult<Prisma.$LogPayload, S>

  type LogCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<LogFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: LogCountAggregateInputType | true
    }

  export interface LogDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Log'], meta: { name: 'Log' } }
    /**
     * Find zero or one Log that matches the filter.
     * @param {LogFindUniqueArgs} args - Arguments to find a Log
     * @example
     * // Get one Log
     * const log = await prisma.log.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends LogFindUniqueArgs>(args: SelectSubset<T, LogFindUniqueArgs<ExtArgs>>): Prisma__LogClient<$Result.GetResult<Prisma.$LogPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Log that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {LogFindUniqueOrThrowArgs} args - Arguments to find a Log
     * @example
     * // Get one Log
     * const log = await prisma.log.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends LogFindUniqueOrThrowArgs>(args: SelectSubset<T, LogFindUniqueOrThrowArgs<ExtArgs>>): Prisma__LogClient<$Result.GetResult<Prisma.$LogPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Log that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {LogFindFirstArgs} args - Arguments to find a Log
     * @example
     * // Get one Log
     * const log = await prisma.log.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends LogFindFirstArgs>(args?: SelectSubset<T, LogFindFirstArgs<ExtArgs>>): Prisma__LogClient<$Result.GetResult<Prisma.$LogPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Log that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {LogFindFirstOrThrowArgs} args - Arguments to find a Log
     * @example
     * // Get one Log
     * const log = await prisma.log.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends LogFindFirstOrThrowArgs>(args?: SelectSubset<T, LogFindFirstOrThrowArgs<ExtArgs>>): Prisma__LogClient<$Result.GetResult<Prisma.$LogPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Logs that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {LogFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Logs
     * const logs = await prisma.log.findMany()
     * 
     * // Get first 10 Logs
     * const logs = await prisma.log.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const logWithIdOnly = await prisma.log.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends LogFindManyArgs>(args?: SelectSubset<T, LogFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$LogPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Log.
     * @param {LogCreateArgs} args - Arguments to create a Log.
     * @example
     * // Create one Log
     * const Log = await prisma.log.create({
     *   data: {
     *     // ... data to create a Log
     *   }
     * })
     * 
     */
    create<T extends LogCreateArgs>(args: SelectSubset<T, LogCreateArgs<ExtArgs>>): Prisma__LogClient<$Result.GetResult<Prisma.$LogPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Logs.
     * @param {LogCreateManyArgs} args - Arguments to create many Logs.
     * @example
     * // Create many Logs
     * const log = await prisma.log.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends LogCreateManyArgs>(args?: SelectSubset<T, LogCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Logs and returns the data saved in the database.
     * @param {LogCreateManyAndReturnArgs} args - Arguments to create many Logs.
     * @example
     * // Create many Logs
     * const log = await prisma.log.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Logs and only return the `id`
     * const logWithIdOnly = await prisma.log.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends LogCreateManyAndReturnArgs>(args?: SelectSubset<T, LogCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$LogPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Log.
     * @param {LogDeleteArgs} args - Arguments to delete one Log.
     * @example
     * // Delete one Log
     * const Log = await prisma.log.delete({
     *   where: {
     *     // ... filter to delete one Log
     *   }
     * })
     * 
     */
    delete<T extends LogDeleteArgs>(args: SelectSubset<T, LogDeleteArgs<ExtArgs>>): Prisma__LogClient<$Result.GetResult<Prisma.$LogPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Log.
     * @param {LogUpdateArgs} args - Arguments to update one Log.
     * @example
     * // Update one Log
     * const log = await prisma.log.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends LogUpdateArgs>(args: SelectSubset<T, LogUpdateArgs<ExtArgs>>): Prisma__LogClient<$Result.GetResult<Prisma.$LogPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Logs.
     * @param {LogDeleteManyArgs} args - Arguments to filter Logs to delete.
     * @example
     * // Delete a few Logs
     * const { count } = await prisma.log.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends LogDeleteManyArgs>(args?: SelectSubset<T, LogDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Logs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {LogUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Logs
     * const log = await prisma.log.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends LogUpdateManyArgs>(args: SelectSubset<T, LogUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Log.
     * @param {LogUpsertArgs} args - Arguments to update or create a Log.
     * @example
     * // Update or create a Log
     * const log = await prisma.log.upsert({
     *   create: {
     *     // ... data to create a Log
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Log we want to update
     *   }
     * })
     */
    upsert<T extends LogUpsertArgs>(args: SelectSubset<T, LogUpsertArgs<ExtArgs>>): Prisma__LogClient<$Result.GetResult<Prisma.$LogPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Logs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {LogCountArgs} args - Arguments to filter Logs to count.
     * @example
     * // Count the number of Logs
     * const count = await prisma.log.count({
     *   where: {
     *     // ... the filter for the Logs we want to count
     *   }
     * })
    **/
    count<T extends LogCountArgs>(
      args?: Subset<T, LogCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], LogCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Log.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {LogAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends LogAggregateArgs>(args: Subset<T, LogAggregateArgs>): Prisma.PrismaPromise<GetLogAggregateType<T>>

    /**
     * Group by Log.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {LogGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends LogGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: LogGroupByArgs['orderBy'] }
        : { orderBy?: LogGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, LogGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetLogGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Log model
   */
  readonly fields: LogFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Log.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__LogClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    session<T extends SessionDefaultArgs<ExtArgs> = {}>(args?: Subset<T, SessionDefaultArgs<ExtArgs>>): Prisma__SessionClient<$Result.GetResult<Prisma.$SessionPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Log model
   */ 
  interface LogFieldRefs {
    readonly id: FieldRef<"Log", 'String'>
    readonly session_id: FieldRef<"Log", 'String'>
    readonly log_type: FieldRef<"Log", 'String'>
    readonly message: FieldRef<"Log", 'String'>
    readonly timestamp: FieldRef<"Log", 'DateTime'>
    readonly createdAt: FieldRef<"Log", 'DateTime'>
    readonly updatedAt: FieldRef<"Log", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Log findUnique
   */
  export type LogFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Log
     */
    select?: LogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: LogInclude<ExtArgs> | null
    /**
     * Filter, which Log to fetch.
     */
    where: LogWhereUniqueInput
  }

  /**
   * Log findUniqueOrThrow
   */
  export type LogFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Log
     */
    select?: LogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: LogInclude<ExtArgs> | null
    /**
     * Filter, which Log to fetch.
     */
    where: LogWhereUniqueInput
  }

  /**
   * Log findFirst
   */
  export type LogFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Log
     */
    select?: LogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: LogInclude<ExtArgs> | null
    /**
     * Filter, which Log to fetch.
     */
    where?: LogWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Logs to fetch.
     */
    orderBy?: LogOrderByWithRelationInput | LogOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Logs.
     */
    cursor?: LogWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Logs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Logs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Logs.
     */
    distinct?: LogScalarFieldEnum | LogScalarFieldEnum[]
  }

  /**
   * Log findFirstOrThrow
   */
  export type LogFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Log
     */
    select?: LogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: LogInclude<ExtArgs> | null
    /**
     * Filter, which Log to fetch.
     */
    where?: LogWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Logs to fetch.
     */
    orderBy?: LogOrderByWithRelationInput | LogOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Logs.
     */
    cursor?: LogWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Logs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Logs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Logs.
     */
    distinct?: LogScalarFieldEnum | LogScalarFieldEnum[]
  }

  /**
   * Log findMany
   */
  export type LogFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Log
     */
    select?: LogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: LogInclude<ExtArgs> | null
    /**
     * Filter, which Logs to fetch.
     */
    where?: LogWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Logs to fetch.
     */
    orderBy?: LogOrderByWithRelationInput | LogOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Logs.
     */
    cursor?: LogWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Logs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Logs.
     */
    skip?: number
    distinct?: LogScalarFieldEnum | LogScalarFieldEnum[]
  }

  /**
   * Log create
   */
  export type LogCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Log
     */
    select?: LogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: LogInclude<ExtArgs> | null
    /**
     * The data needed to create a Log.
     */
    data: XOR<LogCreateInput, LogUncheckedCreateInput>
  }

  /**
   * Log createMany
   */
  export type LogCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Logs.
     */
    data: LogCreateManyInput | LogCreateManyInput[]
  }

  /**
   * Log createManyAndReturn
   */
  export type LogCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Log
     */
    select?: LogSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many Logs.
     */
    data: LogCreateManyInput | LogCreateManyInput[]
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: LogIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * Log update
   */
  export type LogUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Log
     */
    select?: LogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: LogInclude<ExtArgs> | null
    /**
     * The data needed to update a Log.
     */
    data: XOR<LogUpdateInput, LogUncheckedUpdateInput>
    /**
     * Choose, which Log to update.
     */
    where: LogWhereUniqueInput
  }

  /**
   * Log updateMany
   */
  export type LogUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Logs.
     */
    data: XOR<LogUpdateManyMutationInput, LogUncheckedUpdateManyInput>
    /**
     * Filter which Logs to update
     */
    where?: LogWhereInput
  }

  /**
   * Log upsert
   */
  export type LogUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Log
     */
    select?: LogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: LogInclude<ExtArgs> | null
    /**
     * The filter to search for the Log to update in case it exists.
     */
    where: LogWhereUniqueInput
    /**
     * In case the Log found by the `where` argument doesn't exist, create a new Log with this data.
     */
    create: XOR<LogCreateInput, LogUncheckedCreateInput>
    /**
     * In case the Log was found with the provided `where` argument, update it with this data.
     */
    update: XOR<LogUpdateInput, LogUncheckedUpdateInput>
  }

  /**
   * Log delete
   */
  export type LogDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Log
     */
    select?: LogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: LogInclude<ExtArgs> | null
    /**
     * Filter which Log to delete.
     */
    where: LogWhereUniqueInput
  }

  /**
   * Log deleteMany
   */
  export type LogDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Logs to delete
     */
    where?: LogWhereInput
  }

  /**
   * Log without action
   */
  export type LogDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Log
     */
    select?: LogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: LogInclude<ExtArgs> | null
  }


  /**
   * Model Profiling
   */

  export type AggregateProfiling = {
    _count: ProfilingCountAggregateOutputType | null
    _avg: ProfilingAvgAggregateOutputType | null
    _sum: ProfilingSumAggregateOutputType | null
    _min: ProfilingMinAggregateOutputType | null
    _max: ProfilingMaxAggregateOutputType | null
  }

  export type ProfilingAvgAggregateOutputType = {
    id: number | null
  }

  export type ProfilingSumAggregateOutputType = {
    id: number | null
  }

  export type ProfilingMinAggregateOutputType = {
    id: number | null
    session_id: string | null
    cpu: string | null
    memory: string | null
    total_cpu_used: string | null
    total_memory_used: string | null
    raw_cpu_log: string | null
    raw_memory_log: string | null
    timestamp: Date | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type ProfilingMaxAggregateOutputType = {
    id: number | null
    session_id: string | null
    cpu: string | null
    memory: string | null
    total_cpu_used: string | null
    total_memory_used: string | null
    raw_cpu_log: string | null
    raw_memory_log: string | null
    timestamp: Date | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type ProfilingCountAggregateOutputType = {
    id: number
    session_id: number
    cpu: number
    memory: number
    total_cpu_used: number
    total_memory_used: number
    raw_cpu_log: number
    raw_memory_log: number
    timestamp: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type ProfilingAvgAggregateInputType = {
    id?: true
  }

  export type ProfilingSumAggregateInputType = {
    id?: true
  }

  export type ProfilingMinAggregateInputType = {
    id?: true
    session_id?: true
    cpu?: true
    memory?: true
    total_cpu_used?: true
    total_memory_used?: true
    raw_cpu_log?: true
    raw_memory_log?: true
    timestamp?: true
    createdAt?: true
    updatedAt?: true
  }

  export type ProfilingMaxAggregateInputType = {
    id?: true
    session_id?: true
    cpu?: true
    memory?: true
    total_cpu_used?: true
    total_memory_used?: true
    raw_cpu_log?: true
    raw_memory_log?: true
    timestamp?: true
    createdAt?: true
    updatedAt?: true
  }

  export type ProfilingCountAggregateInputType = {
    id?: true
    session_id?: true
    cpu?: true
    memory?: true
    total_cpu_used?: true
    total_memory_used?: true
    raw_cpu_log?: true
    raw_memory_log?: true
    timestamp?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type ProfilingAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Profiling to aggregate.
     */
    where?: ProfilingWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Profilings to fetch.
     */
    orderBy?: ProfilingOrderByWithRelationInput | ProfilingOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: ProfilingWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Profilings from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Profilings.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Profilings
    **/
    _count?: true | ProfilingCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: ProfilingAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: ProfilingSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: ProfilingMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: ProfilingMaxAggregateInputType
  }

  export type GetProfilingAggregateType<T extends ProfilingAggregateArgs> = {
        [P in keyof T & keyof AggregateProfiling]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateProfiling[P]>
      : GetScalarType<T[P], AggregateProfiling[P]>
  }




  export type ProfilingGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: ProfilingWhereInput
    orderBy?: ProfilingOrderByWithAggregationInput | ProfilingOrderByWithAggregationInput[]
    by: ProfilingScalarFieldEnum[] | ProfilingScalarFieldEnum
    having?: ProfilingScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: ProfilingCountAggregateInputType | true
    _avg?: ProfilingAvgAggregateInputType
    _sum?: ProfilingSumAggregateInputType
    _min?: ProfilingMinAggregateInputType
    _max?: ProfilingMaxAggregateInputType
  }

  export type ProfilingGroupByOutputType = {
    id: number
    session_id: string
    cpu: string | null
    memory: string | null
    total_cpu_used: string | null
    total_memory_used: string | null
    raw_cpu_log: string | null
    raw_memory_log: string | null
    timestamp: Date
    createdAt: Date
    updatedAt: Date
    _count: ProfilingCountAggregateOutputType | null
    _avg: ProfilingAvgAggregateOutputType | null
    _sum: ProfilingSumAggregateOutputType | null
    _min: ProfilingMinAggregateOutputType | null
    _max: ProfilingMaxAggregateOutputType | null
  }

  type GetProfilingGroupByPayload<T extends ProfilingGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<ProfilingGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof ProfilingGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], ProfilingGroupByOutputType[P]>
            : GetScalarType<T[P], ProfilingGroupByOutputType[P]>
        }
      >
    >


  export type ProfilingSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    session_id?: boolean
    cpu?: boolean
    memory?: boolean
    total_cpu_used?: boolean
    total_memory_used?: boolean
    raw_cpu_log?: boolean
    raw_memory_log?: boolean
    timestamp?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    session?: boolean | SessionDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["profiling"]>

  export type ProfilingSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    session_id?: boolean
    cpu?: boolean
    memory?: boolean
    total_cpu_used?: boolean
    total_memory_used?: boolean
    raw_cpu_log?: boolean
    raw_memory_log?: boolean
    timestamp?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    session?: boolean | SessionDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["profiling"]>

  export type ProfilingSelectScalar = {
    id?: boolean
    session_id?: boolean
    cpu?: boolean
    memory?: boolean
    total_cpu_used?: boolean
    total_memory_used?: boolean
    raw_cpu_log?: boolean
    raw_memory_log?: boolean
    timestamp?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type ProfilingInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    session?: boolean | SessionDefaultArgs<ExtArgs>
  }
  export type ProfilingIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    session?: boolean | SessionDefaultArgs<ExtArgs>
  }

  export type $ProfilingPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Profiling"
    objects: {
      session: Prisma.$SessionPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: number
      session_id: string
      cpu: string | null
      memory: string | null
      total_cpu_used: string | null
      total_memory_used: string | null
      raw_cpu_log: string | null
      raw_memory_log: string | null
      timestamp: Date
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["profiling"]>
    composites: {}
  }

  type ProfilingGetPayload<S extends boolean | null | undefined | ProfilingDefaultArgs> = $Result.GetResult<Prisma.$ProfilingPayload, S>

  type ProfilingCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<ProfilingFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: ProfilingCountAggregateInputType | true
    }

  export interface ProfilingDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Profiling'], meta: { name: 'Profiling' } }
    /**
     * Find zero or one Profiling that matches the filter.
     * @param {ProfilingFindUniqueArgs} args - Arguments to find a Profiling
     * @example
     * // Get one Profiling
     * const profiling = await prisma.profiling.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends ProfilingFindUniqueArgs>(args: SelectSubset<T, ProfilingFindUniqueArgs<ExtArgs>>): Prisma__ProfilingClient<$Result.GetResult<Prisma.$ProfilingPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Profiling that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {ProfilingFindUniqueOrThrowArgs} args - Arguments to find a Profiling
     * @example
     * // Get one Profiling
     * const profiling = await prisma.profiling.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends ProfilingFindUniqueOrThrowArgs>(args: SelectSubset<T, ProfilingFindUniqueOrThrowArgs<ExtArgs>>): Prisma__ProfilingClient<$Result.GetResult<Prisma.$ProfilingPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Profiling that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProfilingFindFirstArgs} args - Arguments to find a Profiling
     * @example
     * // Get one Profiling
     * const profiling = await prisma.profiling.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends ProfilingFindFirstArgs>(args?: SelectSubset<T, ProfilingFindFirstArgs<ExtArgs>>): Prisma__ProfilingClient<$Result.GetResult<Prisma.$ProfilingPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Profiling that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProfilingFindFirstOrThrowArgs} args - Arguments to find a Profiling
     * @example
     * // Get one Profiling
     * const profiling = await prisma.profiling.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends ProfilingFindFirstOrThrowArgs>(args?: SelectSubset<T, ProfilingFindFirstOrThrowArgs<ExtArgs>>): Prisma__ProfilingClient<$Result.GetResult<Prisma.$ProfilingPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Profilings that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProfilingFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Profilings
     * const profilings = await prisma.profiling.findMany()
     * 
     * // Get first 10 Profilings
     * const profilings = await prisma.profiling.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const profilingWithIdOnly = await prisma.profiling.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends ProfilingFindManyArgs>(args?: SelectSubset<T, ProfilingFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ProfilingPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Profiling.
     * @param {ProfilingCreateArgs} args - Arguments to create a Profiling.
     * @example
     * // Create one Profiling
     * const Profiling = await prisma.profiling.create({
     *   data: {
     *     // ... data to create a Profiling
     *   }
     * })
     * 
     */
    create<T extends ProfilingCreateArgs>(args: SelectSubset<T, ProfilingCreateArgs<ExtArgs>>): Prisma__ProfilingClient<$Result.GetResult<Prisma.$ProfilingPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Profilings.
     * @param {ProfilingCreateManyArgs} args - Arguments to create many Profilings.
     * @example
     * // Create many Profilings
     * const profiling = await prisma.profiling.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends ProfilingCreateManyArgs>(args?: SelectSubset<T, ProfilingCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Profilings and returns the data saved in the database.
     * @param {ProfilingCreateManyAndReturnArgs} args - Arguments to create many Profilings.
     * @example
     * // Create many Profilings
     * const profiling = await prisma.profiling.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Profilings and only return the `id`
     * const profilingWithIdOnly = await prisma.profiling.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends ProfilingCreateManyAndReturnArgs>(args?: SelectSubset<T, ProfilingCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ProfilingPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Profiling.
     * @param {ProfilingDeleteArgs} args - Arguments to delete one Profiling.
     * @example
     * // Delete one Profiling
     * const Profiling = await prisma.profiling.delete({
     *   where: {
     *     // ... filter to delete one Profiling
     *   }
     * })
     * 
     */
    delete<T extends ProfilingDeleteArgs>(args: SelectSubset<T, ProfilingDeleteArgs<ExtArgs>>): Prisma__ProfilingClient<$Result.GetResult<Prisma.$ProfilingPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Profiling.
     * @param {ProfilingUpdateArgs} args - Arguments to update one Profiling.
     * @example
     * // Update one Profiling
     * const profiling = await prisma.profiling.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends ProfilingUpdateArgs>(args: SelectSubset<T, ProfilingUpdateArgs<ExtArgs>>): Prisma__ProfilingClient<$Result.GetResult<Prisma.$ProfilingPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Profilings.
     * @param {ProfilingDeleteManyArgs} args - Arguments to filter Profilings to delete.
     * @example
     * // Delete a few Profilings
     * const { count } = await prisma.profiling.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends ProfilingDeleteManyArgs>(args?: SelectSubset<T, ProfilingDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Profilings.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProfilingUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Profilings
     * const profiling = await prisma.profiling.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends ProfilingUpdateManyArgs>(args: SelectSubset<T, ProfilingUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Profiling.
     * @param {ProfilingUpsertArgs} args - Arguments to update or create a Profiling.
     * @example
     * // Update or create a Profiling
     * const profiling = await prisma.profiling.upsert({
     *   create: {
     *     // ... data to create a Profiling
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Profiling we want to update
     *   }
     * })
     */
    upsert<T extends ProfilingUpsertArgs>(args: SelectSubset<T, ProfilingUpsertArgs<ExtArgs>>): Prisma__ProfilingClient<$Result.GetResult<Prisma.$ProfilingPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Profilings.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProfilingCountArgs} args - Arguments to filter Profilings to count.
     * @example
     * // Count the number of Profilings
     * const count = await prisma.profiling.count({
     *   where: {
     *     // ... the filter for the Profilings we want to count
     *   }
     * })
    **/
    count<T extends ProfilingCountArgs>(
      args?: Subset<T, ProfilingCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], ProfilingCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Profiling.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProfilingAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends ProfilingAggregateArgs>(args: Subset<T, ProfilingAggregateArgs>): Prisma.PrismaPromise<GetProfilingAggregateType<T>>

    /**
     * Group by Profiling.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProfilingGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends ProfilingGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: ProfilingGroupByArgs['orderBy'] }
        : { orderBy?: ProfilingGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, ProfilingGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetProfilingGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Profiling model
   */
  readonly fields: ProfilingFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Profiling.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__ProfilingClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    session<T extends SessionDefaultArgs<ExtArgs> = {}>(args?: Subset<T, SessionDefaultArgs<ExtArgs>>): Prisma__SessionClient<$Result.GetResult<Prisma.$SessionPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Profiling model
   */ 
  interface ProfilingFieldRefs {
    readonly id: FieldRef<"Profiling", 'Int'>
    readonly session_id: FieldRef<"Profiling", 'String'>
    readonly cpu: FieldRef<"Profiling", 'String'>
    readonly memory: FieldRef<"Profiling", 'String'>
    readonly total_cpu_used: FieldRef<"Profiling", 'String'>
    readonly total_memory_used: FieldRef<"Profiling", 'String'>
    readonly raw_cpu_log: FieldRef<"Profiling", 'String'>
    readonly raw_memory_log: FieldRef<"Profiling", 'String'>
    readonly timestamp: FieldRef<"Profiling", 'DateTime'>
    readonly createdAt: FieldRef<"Profiling", 'DateTime'>
    readonly updatedAt: FieldRef<"Profiling", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Profiling findUnique
   */
  export type ProfilingFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Profiling
     */
    select?: ProfilingSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ProfilingInclude<ExtArgs> | null
    /**
     * Filter, which Profiling to fetch.
     */
    where: ProfilingWhereUniqueInput
  }

  /**
   * Profiling findUniqueOrThrow
   */
  export type ProfilingFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Profiling
     */
    select?: ProfilingSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ProfilingInclude<ExtArgs> | null
    /**
     * Filter, which Profiling to fetch.
     */
    where: ProfilingWhereUniqueInput
  }

  /**
   * Profiling findFirst
   */
  export type ProfilingFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Profiling
     */
    select?: ProfilingSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ProfilingInclude<ExtArgs> | null
    /**
     * Filter, which Profiling to fetch.
     */
    where?: ProfilingWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Profilings to fetch.
     */
    orderBy?: ProfilingOrderByWithRelationInput | ProfilingOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Profilings.
     */
    cursor?: ProfilingWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Profilings from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Profilings.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Profilings.
     */
    distinct?: ProfilingScalarFieldEnum | ProfilingScalarFieldEnum[]
  }

  /**
   * Profiling findFirstOrThrow
   */
  export type ProfilingFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Profiling
     */
    select?: ProfilingSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ProfilingInclude<ExtArgs> | null
    /**
     * Filter, which Profiling to fetch.
     */
    where?: ProfilingWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Profilings to fetch.
     */
    orderBy?: ProfilingOrderByWithRelationInput | ProfilingOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Profilings.
     */
    cursor?: ProfilingWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Profilings from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Profilings.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Profilings.
     */
    distinct?: ProfilingScalarFieldEnum | ProfilingScalarFieldEnum[]
  }

  /**
   * Profiling findMany
   */
  export type ProfilingFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Profiling
     */
    select?: ProfilingSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ProfilingInclude<ExtArgs> | null
    /**
     * Filter, which Profilings to fetch.
     */
    where?: ProfilingWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Profilings to fetch.
     */
    orderBy?: ProfilingOrderByWithRelationInput | ProfilingOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Profilings.
     */
    cursor?: ProfilingWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Profilings from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Profilings.
     */
    skip?: number
    distinct?: ProfilingScalarFieldEnum | ProfilingScalarFieldEnum[]
  }

  /**
   * Profiling create
   */
  export type ProfilingCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Profiling
     */
    select?: ProfilingSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ProfilingInclude<ExtArgs> | null
    /**
     * The data needed to create a Profiling.
     */
    data: XOR<ProfilingCreateInput, ProfilingUncheckedCreateInput>
  }

  /**
   * Profiling createMany
   */
  export type ProfilingCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Profilings.
     */
    data: ProfilingCreateManyInput | ProfilingCreateManyInput[]
  }

  /**
   * Profiling createManyAndReturn
   */
  export type ProfilingCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Profiling
     */
    select?: ProfilingSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many Profilings.
     */
    data: ProfilingCreateManyInput | ProfilingCreateManyInput[]
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ProfilingIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * Profiling update
   */
  export type ProfilingUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Profiling
     */
    select?: ProfilingSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ProfilingInclude<ExtArgs> | null
    /**
     * The data needed to update a Profiling.
     */
    data: XOR<ProfilingUpdateInput, ProfilingUncheckedUpdateInput>
    /**
     * Choose, which Profiling to update.
     */
    where: ProfilingWhereUniqueInput
  }

  /**
   * Profiling updateMany
   */
  export type ProfilingUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Profilings.
     */
    data: XOR<ProfilingUpdateManyMutationInput, ProfilingUncheckedUpdateManyInput>
    /**
     * Filter which Profilings to update
     */
    where?: ProfilingWhereInput
  }

  /**
   * Profiling upsert
   */
  export type ProfilingUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Profiling
     */
    select?: ProfilingSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ProfilingInclude<ExtArgs> | null
    /**
     * The filter to search for the Profiling to update in case it exists.
     */
    where: ProfilingWhereUniqueInput
    /**
     * In case the Profiling found by the `where` argument doesn't exist, create a new Profiling with this data.
     */
    create: XOR<ProfilingCreateInput, ProfilingUncheckedCreateInput>
    /**
     * In case the Profiling was found with the provided `where` argument, update it with this data.
     */
    update: XOR<ProfilingUpdateInput, ProfilingUncheckedUpdateInput>
  }

  /**
   * Profiling delete
   */
  export type ProfilingDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Profiling
     */
    select?: ProfilingSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ProfilingInclude<ExtArgs> | null
    /**
     * Filter which Profiling to delete.
     */
    where: ProfilingWhereUniqueInput
  }

  /**
   * Profiling deleteMany
   */
  export type ProfilingDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Profilings to delete
     */
    where?: ProfilingWhereInput
  }

  /**
   * Profiling without action
   */
  export type ProfilingDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Profiling
     */
    select?: ProfilingSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ProfilingInclude<ExtArgs> | null
  }


  /**
   * Model App
   */

  export type AggregateApp = {
    _count: AppCountAggregateOutputType | null
    _avg: AppAvgAggregateOutputType | null
    _sum: AppSumAggregateOutputType | null
    _min: AppMinAggregateOutputType | null
    _max: AppMaxAggregateOutputType | null
  }

  export type AppAvgAggregateOutputType = {
    size: number | null
  }

  export type AppSumAggregateOutputType = {
    size: number | null
  }

  export type AppMinAggregateOutputType = {
    id: string | null
    name: string | null
    filename: string | null
    filepath: string | null
    mimetype: string | null
    size: number | null
    packageName: string | null
    version: string | null
    platform: string | null
    md5: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type AppMaxAggregateOutputType = {
    id: string | null
    name: string | null
    filename: string | null
    filepath: string | null
    mimetype: string | null
    size: number | null
    packageName: string | null
    version: string | null
    platform: string | null
    md5: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type AppCountAggregateOutputType = {
    id: number
    name: number
    filename: number
    filepath: number
    mimetype: number
    size: number
    packageName: number
    version: number
    platform: number
    md5: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type AppAvgAggregateInputType = {
    size?: true
  }

  export type AppSumAggregateInputType = {
    size?: true
  }

  export type AppMinAggregateInputType = {
    id?: true
    name?: true
    filename?: true
    filepath?: true
    mimetype?: true
    size?: true
    packageName?: true
    version?: true
    platform?: true
    md5?: true
    createdAt?: true
    updatedAt?: true
  }

  export type AppMaxAggregateInputType = {
    id?: true
    name?: true
    filename?: true
    filepath?: true
    mimetype?: true
    size?: true
    packageName?: true
    version?: true
    platform?: true
    md5?: true
    createdAt?: true
    updatedAt?: true
  }

  export type AppCountAggregateInputType = {
    id?: true
    name?: true
    filename?: true
    filepath?: true
    mimetype?: true
    size?: true
    packageName?: true
    version?: true
    platform?: true
    md5?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type AppAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which App to aggregate.
     */
    where?: AppWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Apps to fetch.
     */
    orderBy?: AppOrderByWithRelationInput | AppOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: AppWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Apps from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Apps.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Apps
    **/
    _count?: true | AppCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: AppAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: AppSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: AppMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: AppMaxAggregateInputType
  }

  export type GetAppAggregateType<T extends AppAggregateArgs> = {
        [P in keyof T & keyof AggregateApp]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateApp[P]>
      : GetScalarType<T[P], AggregateApp[P]>
  }




  export type AppGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: AppWhereInput
    orderBy?: AppOrderByWithAggregationInput | AppOrderByWithAggregationInput[]
    by: AppScalarFieldEnum[] | AppScalarFieldEnum
    having?: AppScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: AppCountAggregateInputType | true
    _avg?: AppAvgAggregateInputType
    _sum?: AppSumAggregateInputType
    _min?: AppMinAggregateInputType
    _max?: AppMaxAggregateInputType
  }

  export type AppGroupByOutputType = {
    id: string
    name: string
    filename: string
    filepath: string
    mimetype: string
    size: number
    packageName: string | null
    version: string | null
    platform: string | null
    md5: string | null
    createdAt: Date
    updatedAt: Date
    _count: AppCountAggregateOutputType | null
    _avg: AppAvgAggregateOutputType | null
    _sum: AppSumAggregateOutputType | null
    _min: AppMinAggregateOutputType | null
    _max: AppMaxAggregateOutputType | null
  }

  type GetAppGroupByPayload<T extends AppGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<AppGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof AppGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], AppGroupByOutputType[P]>
            : GetScalarType<T[P], AppGroupByOutputType[P]>
        }
      >
    >


  export type AppSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    filename?: boolean
    filepath?: boolean
    mimetype?: boolean
    size?: boolean
    packageName?: boolean
    version?: boolean
    platform?: boolean
    md5?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["app"]>

  export type AppSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    filename?: boolean
    filepath?: boolean
    mimetype?: boolean
    size?: boolean
    packageName?: boolean
    version?: boolean
    platform?: boolean
    md5?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["app"]>

  export type AppSelectScalar = {
    id?: boolean
    name?: boolean
    filename?: boolean
    filepath?: boolean
    mimetype?: boolean
    size?: boolean
    packageName?: boolean
    version?: boolean
    platform?: boolean
    md5?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }


  export type $AppPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "App"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      name: string
      filename: string
      filepath: string
      mimetype: string
      size: number
      packageName: string | null
      version: string | null
      platform: string | null
      md5: string | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["app"]>
    composites: {}
  }

  type AppGetPayload<S extends boolean | null | undefined | AppDefaultArgs> = $Result.GetResult<Prisma.$AppPayload, S>

  type AppCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<AppFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: AppCountAggregateInputType | true
    }

  export interface AppDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['App'], meta: { name: 'App' } }
    /**
     * Find zero or one App that matches the filter.
     * @param {AppFindUniqueArgs} args - Arguments to find a App
     * @example
     * // Get one App
     * const app = await prisma.app.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends AppFindUniqueArgs>(args: SelectSubset<T, AppFindUniqueArgs<ExtArgs>>): Prisma__AppClient<$Result.GetResult<Prisma.$AppPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one App that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {AppFindUniqueOrThrowArgs} args - Arguments to find a App
     * @example
     * // Get one App
     * const app = await prisma.app.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends AppFindUniqueOrThrowArgs>(args: SelectSubset<T, AppFindUniqueOrThrowArgs<ExtArgs>>): Prisma__AppClient<$Result.GetResult<Prisma.$AppPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first App that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AppFindFirstArgs} args - Arguments to find a App
     * @example
     * // Get one App
     * const app = await prisma.app.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends AppFindFirstArgs>(args?: SelectSubset<T, AppFindFirstArgs<ExtArgs>>): Prisma__AppClient<$Result.GetResult<Prisma.$AppPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first App that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AppFindFirstOrThrowArgs} args - Arguments to find a App
     * @example
     * // Get one App
     * const app = await prisma.app.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends AppFindFirstOrThrowArgs>(args?: SelectSubset<T, AppFindFirstOrThrowArgs<ExtArgs>>): Prisma__AppClient<$Result.GetResult<Prisma.$AppPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Apps that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AppFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Apps
     * const apps = await prisma.app.findMany()
     * 
     * // Get first 10 Apps
     * const apps = await prisma.app.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const appWithIdOnly = await prisma.app.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends AppFindManyArgs>(args?: SelectSubset<T, AppFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AppPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a App.
     * @param {AppCreateArgs} args - Arguments to create a App.
     * @example
     * // Create one App
     * const App = await prisma.app.create({
     *   data: {
     *     // ... data to create a App
     *   }
     * })
     * 
     */
    create<T extends AppCreateArgs>(args: SelectSubset<T, AppCreateArgs<ExtArgs>>): Prisma__AppClient<$Result.GetResult<Prisma.$AppPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Apps.
     * @param {AppCreateManyArgs} args - Arguments to create many Apps.
     * @example
     * // Create many Apps
     * const app = await prisma.app.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends AppCreateManyArgs>(args?: SelectSubset<T, AppCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Apps and returns the data saved in the database.
     * @param {AppCreateManyAndReturnArgs} args - Arguments to create many Apps.
     * @example
     * // Create many Apps
     * const app = await prisma.app.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Apps and only return the `id`
     * const appWithIdOnly = await prisma.app.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends AppCreateManyAndReturnArgs>(args?: SelectSubset<T, AppCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AppPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a App.
     * @param {AppDeleteArgs} args - Arguments to delete one App.
     * @example
     * // Delete one App
     * const App = await prisma.app.delete({
     *   where: {
     *     // ... filter to delete one App
     *   }
     * })
     * 
     */
    delete<T extends AppDeleteArgs>(args: SelectSubset<T, AppDeleteArgs<ExtArgs>>): Prisma__AppClient<$Result.GetResult<Prisma.$AppPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one App.
     * @param {AppUpdateArgs} args - Arguments to update one App.
     * @example
     * // Update one App
     * const app = await prisma.app.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends AppUpdateArgs>(args: SelectSubset<T, AppUpdateArgs<ExtArgs>>): Prisma__AppClient<$Result.GetResult<Prisma.$AppPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Apps.
     * @param {AppDeleteManyArgs} args - Arguments to filter Apps to delete.
     * @example
     * // Delete a few Apps
     * const { count } = await prisma.app.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends AppDeleteManyArgs>(args?: SelectSubset<T, AppDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Apps.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AppUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Apps
     * const app = await prisma.app.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends AppUpdateManyArgs>(args: SelectSubset<T, AppUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one App.
     * @param {AppUpsertArgs} args - Arguments to update or create a App.
     * @example
     * // Update or create a App
     * const app = await prisma.app.upsert({
     *   create: {
     *     // ... data to create a App
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the App we want to update
     *   }
     * })
     */
    upsert<T extends AppUpsertArgs>(args: SelectSubset<T, AppUpsertArgs<ExtArgs>>): Prisma__AppClient<$Result.GetResult<Prisma.$AppPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Apps.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AppCountArgs} args - Arguments to filter Apps to count.
     * @example
     * // Count the number of Apps
     * const count = await prisma.app.count({
     *   where: {
     *     // ... the filter for the Apps we want to count
     *   }
     * })
    **/
    count<T extends AppCountArgs>(
      args?: Subset<T, AppCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], AppCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a App.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AppAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends AppAggregateArgs>(args: Subset<T, AppAggregateArgs>): Prisma.PrismaPromise<GetAppAggregateType<T>>

    /**
     * Group by App.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AppGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends AppGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: AppGroupByArgs['orderBy'] }
        : { orderBy?: AppGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, AppGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetAppGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the App model
   */
  readonly fields: AppFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for App.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__AppClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the App model
   */ 
  interface AppFieldRefs {
    readonly id: FieldRef<"App", 'String'>
    readonly name: FieldRef<"App", 'String'>
    readonly filename: FieldRef<"App", 'String'>
    readonly filepath: FieldRef<"App", 'String'>
    readonly mimetype: FieldRef<"App", 'String'>
    readonly size: FieldRef<"App", 'Int'>
    readonly packageName: FieldRef<"App", 'String'>
    readonly version: FieldRef<"App", 'String'>
    readonly platform: FieldRef<"App", 'String'>
    readonly md5: FieldRef<"App", 'String'>
    readonly createdAt: FieldRef<"App", 'DateTime'>
    readonly updatedAt: FieldRef<"App", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * App findUnique
   */
  export type AppFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the App
     */
    select?: AppSelect<ExtArgs> | null
    /**
     * Filter, which App to fetch.
     */
    where: AppWhereUniqueInput
  }

  /**
   * App findUniqueOrThrow
   */
  export type AppFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the App
     */
    select?: AppSelect<ExtArgs> | null
    /**
     * Filter, which App to fetch.
     */
    where: AppWhereUniqueInput
  }

  /**
   * App findFirst
   */
  export type AppFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the App
     */
    select?: AppSelect<ExtArgs> | null
    /**
     * Filter, which App to fetch.
     */
    where?: AppWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Apps to fetch.
     */
    orderBy?: AppOrderByWithRelationInput | AppOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Apps.
     */
    cursor?: AppWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Apps from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Apps.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Apps.
     */
    distinct?: AppScalarFieldEnum | AppScalarFieldEnum[]
  }

  /**
   * App findFirstOrThrow
   */
  export type AppFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the App
     */
    select?: AppSelect<ExtArgs> | null
    /**
     * Filter, which App to fetch.
     */
    where?: AppWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Apps to fetch.
     */
    orderBy?: AppOrderByWithRelationInput | AppOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Apps.
     */
    cursor?: AppWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Apps from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Apps.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Apps.
     */
    distinct?: AppScalarFieldEnum | AppScalarFieldEnum[]
  }

  /**
   * App findMany
   */
  export type AppFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the App
     */
    select?: AppSelect<ExtArgs> | null
    /**
     * Filter, which Apps to fetch.
     */
    where?: AppWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Apps to fetch.
     */
    orderBy?: AppOrderByWithRelationInput | AppOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Apps.
     */
    cursor?: AppWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Apps from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Apps.
     */
    skip?: number
    distinct?: AppScalarFieldEnum | AppScalarFieldEnum[]
  }

  /**
   * App create
   */
  export type AppCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the App
     */
    select?: AppSelect<ExtArgs> | null
    /**
     * The data needed to create a App.
     */
    data: XOR<AppCreateInput, AppUncheckedCreateInput>
  }

  /**
   * App createMany
   */
  export type AppCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Apps.
     */
    data: AppCreateManyInput | AppCreateManyInput[]
  }

  /**
   * App createManyAndReturn
   */
  export type AppCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the App
     */
    select?: AppSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many Apps.
     */
    data: AppCreateManyInput | AppCreateManyInput[]
  }

  /**
   * App update
   */
  export type AppUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the App
     */
    select?: AppSelect<ExtArgs> | null
    /**
     * The data needed to update a App.
     */
    data: XOR<AppUpdateInput, AppUncheckedUpdateInput>
    /**
     * Choose, which App to update.
     */
    where: AppWhereUniqueInput
  }

  /**
   * App updateMany
   */
  export type AppUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Apps.
     */
    data: XOR<AppUpdateManyMutationInput, AppUncheckedUpdateManyInput>
    /**
     * Filter which Apps to update
     */
    where?: AppWhereInput
  }

  /**
   * App upsert
   */
  export type AppUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the App
     */
    select?: AppSelect<ExtArgs> | null
    /**
     * The filter to search for the App to update in case it exists.
     */
    where: AppWhereUniqueInput
    /**
     * In case the App found by the `where` argument doesn't exist, create a new App with this data.
     */
    create: XOR<AppCreateInput, AppUncheckedCreateInput>
    /**
     * In case the App was found with the provided `where` argument, update it with this data.
     */
    update: XOR<AppUpdateInput, AppUncheckedUpdateInput>
  }

  /**
   * App delete
   */
  export type AppDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the App
     */
    select?: AppSelect<ExtArgs> | null
    /**
     * Filter which App to delete.
     */
    where: AppWhereUniqueInput
  }

  /**
   * App deleteMany
   */
  export type AppDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Apps to delete
     */
    where?: AppWhereInput
  }

  /**
   * App without action
   */
  export type AppDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the App
     */
    select?: AppSelect<ExtArgs> | null
  }


  /**
   * Model Device
   */

  export type AggregateDevice = {
    _count: DeviceCountAggregateOutputType | null
    _avg: DeviceAvgAggregateOutputType | null
    _sum: DeviceSumAggregateOutputType | null
    _min: DeviceMinAggregateOutputType | null
    _max: DeviceMaxAggregateOutputType | null
  }

  export type DeviceAvgAggregateOutputType = {
    systemPort: number | null
    proxyPort: number | null
    wdaLocalPort: number | null
    mjpegServerPort: number | null
    lastCmdExecutedAt: number | null
    totalUtilizationTimeMilliSec: number | null
    sessionStartTime: number | null
    newCommandTimeout: number | null
    adbPort: number | null
    total_session_count: number | null
    lastHealthCheckAt: number | null
    batteryLevel: number | null
    reservedUntil: number | null
    totalHealedCount: number | null
    locked_at: number | null
  }

  export type DeviceSumAggregateOutputType = {
    systemPort: number | null
    proxyPort: number | null
    wdaLocalPort: number | null
    mjpegServerPort: number | null
    lastCmdExecutedAt: number | null
    totalUtilizationTimeMilliSec: number | null
    sessionStartTime: number | null
    newCommandTimeout: number | null
    adbPort: number | null
    total_session_count: number | null
    lastHealthCheckAt: number | null
    batteryLevel: number | null
    reservedUntil: number | null
    totalHealedCount: number | null
    locked_at: number | null
  }

  export type DeviceMinAggregateOutputType = {
    udid: string | null
    host: string | null
    systemPort: number | null
    proxyPort: number | null
    proxyHost: string | null
    wdaLocalPort: number | null
    name: string | null
    state: string | null
    sdk: string | null
    platform: string | null
    deviceType: string | null
    busy: boolean | null
    userBlocked: boolean | null
    realDevice: boolean | null
    session_id: string | null
    offline: boolean | null
    mjpegServerPort: number | null
    lastCmdExecutedAt: number | null
    totalUtilizationTimeMilliSec: number | null
    sessionStartTime: number | null
    newCommandTimeout: number | null
    cloud: string | null
    derivedDataPath: string | null
    chromeDriverPath: string | null
    capability: string | null
    adbRemoteHost: string | null
    adbPort: number | null
    nodeId: string | null
    screenWidth: string | null
    screenHeight: string | null
    dashboard_link: string | null
    total_session_count: number | null
    createdAt: Date | null
    updatedAt: Date | null
    healthCheckError: string | null
    healthStatus: string | null
    lastHealthCheckAt: number | null
    batteryLevel: number | null
    reservationReason: string | null
    reservedBy: string | null
    reservedUntil: number | null
    storageFree: string | null
    tags: string | null
    thermalStatus: string | null
    sessionProgress: string | null
    totalHealedCount: number | null
    ip: string | null
    cpuArchitecture: string | null
    owning_session_id: string | null
    locked_at: number | null
  }

  export type DeviceMaxAggregateOutputType = {
    udid: string | null
    host: string | null
    systemPort: number | null
    proxyPort: number | null
    proxyHost: string | null
    wdaLocalPort: number | null
    name: string | null
    state: string | null
    sdk: string | null
    platform: string | null
    deviceType: string | null
    busy: boolean | null
    userBlocked: boolean | null
    realDevice: boolean | null
    session_id: string | null
    offline: boolean | null
    mjpegServerPort: number | null
    lastCmdExecutedAt: number | null
    totalUtilizationTimeMilliSec: number | null
    sessionStartTime: number | null
    newCommandTimeout: number | null
    cloud: string | null
    derivedDataPath: string | null
    chromeDriverPath: string | null
    capability: string | null
    adbRemoteHost: string | null
    adbPort: number | null
    nodeId: string | null
    screenWidth: string | null
    screenHeight: string | null
    dashboard_link: string | null
    total_session_count: number | null
    createdAt: Date | null
    updatedAt: Date | null
    healthCheckError: string | null
    healthStatus: string | null
    lastHealthCheckAt: number | null
    batteryLevel: number | null
    reservationReason: string | null
    reservedBy: string | null
    reservedUntil: number | null
    storageFree: string | null
    tags: string | null
    thermalStatus: string | null
    sessionProgress: string | null
    totalHealedCount: number | null
    ip: string | null
    cpuArchitecture: string | null
    owning_session_id: string | null
    locked_at: number | null
  }

  export type DeviceCountAggregateOutputType = {
    udid: number
    host: number
    systemPort: number
    proxyPort: number
    proxyHost: number
    wdaLocalPort: number
    name: number
    state: number
    sdk: number
    platform: number
    deviceType: number
    busy: number
    userBlocked: number
    realDevice: number
    session_id: number
    offline: number
    mjpegServerPort: number
    lastCmdExecutedAt: number
    totalUtilizationTimeMilliSec: number
    sessionStartTime: number
    newCommandTimeout: number
    cloud: number
    derivedDataPath: number
    chromeDriverPath: number
    capability: number
    adbRemoteHost: number
    adbPort: number
    nodeId: number
    screenWidth: number
    screenHeight: number
    dashboard_link: number
    total_session_count: number
    createdAt: number
    updatedAt: number
    healthCheckError: number
    healthStatus: number
    lastHealthCheckAt: number
    batteryLevel: number
    reservationReason: number
    reservedBy: number
    reservedUntil: number
    storageFree: number
    tags: number
    thermalStatus: number
    sessionProgress: number
    totalHealedCount: number
    ip: number
    cpuArchitecture: number
    owning_session_id: number
    locked_at: number
    _all: number
  }


  export type DeviceAvgAggregateInputType = {
    systemPort?: true
    proxyPort?: true
    wdaLocalPort?: true
    mjpegServerPort?: true
    lastCmdExecutedAt?: true
    totalUtilizationTimeMilliSec?: true
    sessionStartTime?: true
    newCommandTimeout?: true
    adbPort?: true
    total_session_count?: true
    lastHealthCheckAt?: true
    batteryLevel?: true
    reservedUntil?: true
    totalHealedCount?: true
    locked_at?: true
  }

  export type DeviceSumAggregateInputType = {
    systemPort?: true
    proxyPort?: true
    wdaLocalPort?: true
    mjpegServerPort?: true
    lastCmdExecutedAt?: true
    totalUtilizationTimeMilliSec?: true
    sessionStartTime?: true
    newCommandTimeout?: true
    adbPort?: true
    total_session_count?: true
    lastHealthCheckAt?: true
    batteryLevel?: true
    reservedUntil?: true
    totalHealedCount?: true
    locked_at?: true
  }

  export type DeviceMinAggregateInputType = {
    udid?: true
    host?: true
    systemPort?: true
    proxyPort?: true
    proxyHost?: true
    wdaLocalPort?: true
    name?: true
    state?: true
    sdk?: true
    platform?: true
    deviceType?: true
    busy?: true
    userBlocked?: true
    realDevice?: true
    session_id?: true
    offline?: true
    mjpegServerPort?: true
    lastCmdExecutedAt?: true
    totalUtilizationTimeMilliSec?: true
    sessionStartTime?: true
    newCommandTimeout?: true
    cloud?: true
    derivedDataPath?: true
    chromeDriverPath?: true
    capability?: true
    adbRemoteHost?: true
    adbPort?: true
    nodeId?: true
    screenWidth?: true
    screenHeight?: true
    dashboard_link?: true
    total_session_count?: true
    createdAt?: true
    updatedAt?: true
    healthCheckError?: true
    healthStatus?: true
    lastHealthCheckAt?: true
    batteryLevel?: true
    reservationReason?: true
    reservedBy?: true
    reservedUntil?: true
    storageFree?: true
    tags?: true
    thermalStatus?: true
    sessionProgress?: true
    totalHealedCount?: true
    ip?: true
    cpuArchitecture?: true
    owning_session_id?: true
    locked_at?: true
  }

  export type DeviceMaxAggregateInputType = {
    udid?: true
    host?: true
    systemPort?: true
    proxyPort?: true
    proxyHost?: true
    wdaLocalPort?: true
    name?: true
    state?: true
    sdk?: true
    platform?: true
    deviceType?: true
    busy?: true
    userBlocked?: true
    realDevice?: true
    session_id?: true
    offline?: true
    mjpegServerPort?: true
    lastCmdExecutedAt?: true
    totalUtilizationTimeMilliSec?: true
    sessionStartTime?: true
    newCommandTimeout?: true
    cloud?: true
    derivedDataPath?: true
    chromeDriverPath?: true
    capability?: true
    adbRemoteHost?: true
    adbPort?: true
    nodeId?: true
    screenWidth?: true
    screenHeight?: true
    dashboard_link?: true
    total_session_count?: true
    createdAt?: true
    updatedAt?: true
    healthCheckError?: true
    healthStatus?: true
    lastHealthCheckAt?: true
    batteryLevel?: true
    reservationReason?: true
    reservedBy?: true
    reservedUntil?: true
    storageFree?: true
    tags?: true
    thermalStatus?: true
    sessionProgress?: true
    totalHealedCount?: true
    ip?: true
    cpuArchitecture?: true
    owning_session_id?: true
    locked_at?: true
  }

  export type DeviceCountAggregateInputType = {
    udid?: true
    host?: true
    systemPort?: true
    proxyPort?: true
    proxyHost?: true
    wdaLocalPort?: true
    name?: true
    state?: true
    sdk?: true
    platform?: true
    deviceType?: true
    busy?: true
    userBlocked?: true
    realDevice?: true
    session_id?: true
    offline?: true
    mjpegServerPort?: true
    lastCmdExecutedAt?: true
    totalUtilizationTimeMilliSec?: true
    sessionStartTime?: true
    newCommandTimeout?: true
    cloud?: true
    derivedDataPath?: true
    chromeDriverPath?: true
    capability?: true
    adbRemoteHost?: true
    adbPort?: true
    nodeId?: true
    screenWidth?: true
    screenHeight?: true
    dashboard_link?: true
    total_session_count?: true
    createdAt?: true
    updatedAt?: true
    healthCheckError?: true
    healthStatus?: true
    lastHealthCheckAt?: true
    batteryLevel?: true
    reservationReason?: true
    reservedBy?: true
    reservedUntil?: true
    storageFree?: true
    tags?: true
    thermalStatus?: true
    sessionProgress?: true
    totalHealedCount?: true
    ip?: true
    cpuArchitecture?: true
    owning_session_id?: true
    locked_at?: true
    _all?: true
  }

  export type DeviceAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Device to aggregate.
     */
    where?: DeviceWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Devices to fetch.
     */
    orderBy?: DeviceOrderByWithRelationInput | DeviceOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: DeviceWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Devices from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Devices.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Devices
    **/
    _count?: true | DeviceCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: DeviceAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: DeviceSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: DeviceMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: DeviceMaxAggregateInputType
  }

  export type GetDeviceAggregateType<T extends DeviceAggregateArgs> = {
        [P in keyof T & keyof AggregateDevice]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateDevice[P]>
      : GetScalarType<T[P], AggregateDevice[P]>
  }




  export type DeviceGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: DeviceWhereInput
    orderBy?: DeviceOrderByWithAggregationInput | DeviceOrderByWithAggregationInput[]
    by: DeviceScalarFieldEnum[] | DeviceScalarFieldEnum
    having?: DeviceScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: DeviceCountAggregateInputType | true
    _avg?: DeviceAvgAggregateInputType
    _sum?: DeviceSumAggregateInputType
    _min?: DeviceMinAggregateInputType
    _max?: DeviceMaxAggregateInputType
  }

  export type DeviceGroupByOutputType = {
    udid: string
    host: string
    systemPort: number | null
    proxyPort: number | null
    proxyHost: string | null
    wdaLocalPort: number | null
    name: string | null
    state: string | null
    sdk: string | null
    platform: string | null
    deviceType: string | null
    busy: boolean | null
    userBlocked: boolean | null
    realDevice: boolean | null
    session_id: string | null
    offline: boolean | null
    mjpegServerPort: number | null
    lastCmdExecutedAt: number | null
    totalUtilizationTimeMilliSec: number
    sessionStartTime: number
    newCommandTimeout: number | null
    cloud: string | null
    derivedDataPath: string | null
    chromeDriverPath: string | null
    capability: string | null
    adbRemoteHost: string | null
    adbPort: number | null
    nodeId: string | null
    screenWidth: string | null
    screenHeight: string | null
    dashboard_link: string | null
    total_session_count: number | null
    createdAt: Date
    updatedAt: Date
    healthCheckError: string | null
    healthStatus: string | null
    lastHealthCheckAt: number | null
    batteryLevel: number | null
    reservationReason: string | null
    reservedBy: string | null
    reservedUntil: number | null
    storageFree: string | null
    tags: string | null
    thermalStatus: string | null
    sessionProgress: string | null
    totalHealedCount: number | null
    ip: string | null
    cpuArchitecture: string | null
    owning_session_id: string | null
    locked_at: number | null
    _count: DeviceCountAggregateOutputType | null
    _avg: DeviceAvgAggregateOutputType | null
    _sum: DeviceSumAggregateOutputType | null
    _min: DeviceMinAggregateOutputType | null
    _max: DeviceMaxAggregateOutputType | null
  }

  type GetDeviceGroupByPayload<T extends DeviceGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<DeviceGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof DeviceGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], DeviceGroupByOutputType[P]>
            : GetScalarType<T[P], DeviceGroupByOutputType[P]>
        }
      >
    >


  export type DeviceSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    udid?: boolean
    host?: boolean
    systemPort?: boolean
    proxyPort?: boolean
    proxyHost?: boolean
    wdaLocalPort?: boolean
    name?: boolean
    state?: boolean
    sdk?: boolean
    platform?: boolean
    deviceType?: boolean
    busy?: boolean
    userBlocked?: boolean
    realDevice?: boolean
    session_id?: boolean
    offline?: boolean
    mjpegServerPort?: boolean
    lastCmdExecutedAt?: boolean
    totalUtilizationTimeMilliSec?: boolean
    sessionStartTime?: boolean
    newCommandTimeout?: boolean
    cloud?: boolean
    derivedDataPath?: boolean
    chromeDriverPath?: boolean
    capability?: boolean
    adbRemoteHost?: boolean
    adbPort?: boolean
    nodeId?: boolean
    screenWidth?: boolean
    screenHeight?: boolean
    dashboard_link?: boolean
    total_session_count?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    healthCheckError?: boolean
    healthStatus?: boolean
    lastHealthCheckAt?: boolean
    batteryLevel?: boolean
    reservationReason?: boolean
    reservedBy?: boolean
    reservedUntil?: boolean
    storageFree?: boolean
    tags?: boolean
    thermalStatus?: boolean
    sessionProgress?: boolean
    totalHealedCount?: boolean
    ip?: boolean
    cpuArchitecture?: boolean
    owning_session_id?: boolean
    locked_at?: boolean
  }, ExtArgs["result"]["device"]>

  export type DeviceSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    udid?: boolean
    host?: boolean
    systemPort?: boolean
    proxyPort?: boolean
    proxyHost?: boolean
    wdaLocalPort?: boolean
    name?: boolean
    state?: boolean
    sdk?: boolean
    platform?: boolean
    deviceType?: boolean
    busy?: boolean
    userBlocked?: boolean
    realDevice?: boolean
    session_id?: boolean
    offline?: boolean
    mjpegServerPort?: boolean
    lastCmdExecutedAt?: boolean
    totalUtilizationTimeMilliSec?: boolean
    sessionStartTime?: boolean
    newCommandTimeout?: boolean
    cloud?: boolean
    derivedDataPath?: boolean
    chromeDriverPath?: boolean
    capability?: boolean
    adbRemoteHost?: boolean
    adbPort?: boolean
    nodeId?: boolean
    screenWidth?: boolean
    screenHeight?: boolean
    dashboard_link?: boolean
    total_session_count?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    healthCheckError?: boolean
    healthStatus?: boolean
    lastHealthCheckAt?: boolean
    batteryLevel?: boolean
    reservationReason?: boolean
    reservedBy?: boolean
    reservedUntil?: boolean
    storageFree?: boolean
    tags?: boolean
    thermalStatus?: boolean
    sessionProgress?: boolean
    totalHealedCount?: boolean
    ip?: boolean
    cpuArchitecture?: boolean
    owning_session_id?: boolean
    locked_at?: boolean
  }, ExtArgs["result"]["device"]>

  export type DeviceSelectScalar = {
    udid?: boolean
    host?: boolean
    systemPort?: boolean
    proxyPort?: boolean
    proxyHost?: boolean
    wdaLocalPort?: boolean
    name?: boolean
    state?: boolean
    sdk?: boolean
    platform?: boolean
    deviceType?: boolean
    busy?: boolean
    userBlocked?: boolean
    realDevice?: boolean
    session_id?: boolean
    offline?: boolean
    mjpegServerPort?: boolean
    lastCmdExecutedAt?: boolean
    totalUtilizationTimeMilliSec?: boolean
    sessionStartTime?: boolean
    newCommandTimeout?: boolean
    cloud?: boolean
    derivedDataPath?: boolean
    chromeDriverPath?: boolean
    capability?: boolean
    adbRemoteHost?: boolean
    adbPort?: boolean
    nodeId?: boolean
    screenWidth?: boolean
    screenHeight?: boolean
    dashboard_link?: boolean
    total_session_count?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    healthCheckError?: boolean
    healthStatus?: boolean
    lastHealthCheckAt?: boolean
    batteryLevel?: boolean
    reservationReason?: boolean
    reservedBy?: boolean
    reservedUntil?: boolean
    storageFree?: boolean
    tags?: boolean
    thermalStatus?: boolean
    sessionProgress?: boolean
    totalHealedCount?: boolean
    ip?: boolean
    cpuArchitecture?: boolean
    owning_session_id?: boolean
    locked_at?: boolean
  }


  export type $DevicePayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Device"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      udid: string
      host: string
      systemPort: number | null
      proxyPort: number | null
      proxyHost: string | null
      wdaLocalPort: number | null
      name: string | null
      state: string | null
      sdk: string | null
      platform: string | null
      deviceType: string | null
      busy: boolean | null
      userBlocked: boolean | null
      realDevice: boolean | null
      session_id: string | null
      offline: boolean | null
      mjpegServerPort: number | null
      lastCmdExecutedAt: number | null
      totalUtilizationTimeMilliSec: number
      sessionStartTime: number
      newCommandTimeout: number | null
      cloud: string | null
      derivedDataPath: string | null
      chromeDriverPath: string | null
      capability: string | null
      adbRemoteHost: string | null
      adbPort: number | null
      nodeId: string | null
      screenWidth: string | null
      screenHeight: string | null
      dashboard_link: string | null
      total_session_count: number | null
      createdAt: Date
      updatedAt: Date
      healthCheckError: string | null
      healthStatus: string | null
      lastHealthCheckAt: number | null
      batteryLevel: number | null
      reservationReason: string | null
      reservedBy: string | null
      reservedUntil: number | null
      storageFree: string | null
      tags: string | null
      thermalStatus: string | null
      sessionProgress: string | null
      totalHealedCount: number | null
      ip: string | null
      cpuArchitecture: string | null
      owning_session_id: string | null
      locked_at: number | null
    }, ExtArgs["result"]["device"]>
    composites: {}
  }

  type DeviceGetPayload<S extends boolean | null | undefined | DeviceDefaultArgs> = $Result.GetResult<Prisma.$DevicePayload, S>

  type DeviceCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<DeviceFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: DeviceCountAggregateInputType | true
    }

  export interface DeviceDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Device'], meta: { name: 'Device' } }
    /**
     * Find zero or one Device that matches the filter.
     * @param {DeviceFindUniqueArgs} args - Arguments to find a Device
     * @example
     * // Get one Device
     * const device = await prisma.device.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends DeviceFindUniqueArgs>(args: SelectSubset<T, DeviceFindUniqueArgs<ExtArgs>>): Prisma__DeviceClient<$Result.GetResult<Prisma.$DevicePayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Device that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {DeviceFindUniqueOrThrowArgs} args - Arguments to find a Device
     * @example
     * // Get one Device
     * const device = await prisma.device.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends DeviceFindUniqueOrThrowArgs>(args: SelectSubset<T, DeviceFindUniqueOrThrowArgs<ExtArgs>>): Prisma__DeviceClient<$Result.GetResult<Prisma.$DevicePayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Device that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {DeviceFindFirstArgs} args - Arguments to find a Device
     * @example
     * // Get one Device
     * const device = await prisma.device.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends DeviceFindFirstArgs>(args?: SelectSubset<T, DeviceFindFirstArgs<ExtArgs>>): Prisma__DeviceClient<$Result.GetResult<Prisma.$DevicePayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Device that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {DeviceFindFirstOrThrowArgs} args - Arguments to find a Device
     * @example
     * // Get one Device
     * const device = await prisma.device.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends DeviceFindFirstOrThrowArgs>(args?: SelectSubset<T, DeviceFindFirstOrThrowArgs<ExtArgs>>): Prisma__DeviceClient<$Result.GetResult<Prisma.$DevicePayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Devices that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {DeviceFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Devices
     * const devices = await prisma.device.findMany()
     * 
     * // Get first 10 Devices
     * const devices = await prisma.device.findMany({ take: 10 })
     * 
     * // Only select the `udid`
     * const deviceWithUdidOnly = await prisma.device.findMany({ select: { udid: true } })
     * 
     */
    findMany<T extends DeviceFindManyArgs>(args?: SelectSubset<T, DeviceFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$DevicePayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Device.
     * @param {DeviceCreateArgs} args - Arguments to create a Device.
     * @example
     * // Create one Device
     * const Device = await prisma.device.create({
     *   data: {
     *     // ... data to create a Device
     *   }
     * })
     * 
     */
    create<T extends DeviceCreateArgs>(args: SelectSubset<T, DeviceCreateArgs<ExtArgs>>): Prisma__DeviceClient<$Result.GetResult<Prisma.$DevicePayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Devices.
     * @param {DeviceCreateManyArgs} args - Arguments to create many Devices.
     * @example
     * // Create many Devices
     * const device = await prisma.device.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends DeviceCreateManyArgs>(args?: SelectSubset<T, DeviceCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Devices and returns the data saved in the database.
     * @param {DeviceCreateManyAndReturnArgs} args - Arguments to create many Devices.
     * @example
     * // Create many Devices
     * const device = await prisma.device.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Devices and only return the `udid`
     * const deviceWithUdidOnly = await prisma.device.createManyAndReturn({ 
     *   select: { udid: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends DeviceCreateManyAndReturnArgs>(args?: SelectSubset<T, DeviceCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$DevicePayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Device.
     * @param {DeviceDeleteArgs} args - Arguments to delete one Device.
     * @example
     * // Delete one Device
     * const Device = await prisma.device.delete({
     *   where: {
     *     // ... filter to delete one Device
     *   }
     * })
     * 
     */
    delete<T extends DeviceDeleteArgs>(args: SelectSubset<T, DeviceDeleteArgs<ExtArgs>>): Prisma__DeviceClient<$Result.GetResult<Prisma.$DevicePayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Device.
     * @param {DeviceUpdateArgs} args - Arguments to update one Device.
     * @example
     * // Update one Device
     * const device = await prisma.device.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends DeviceUpdateArgs>(args: SelectSubset<T, DeviceUpdateArgs<ExtArgs>>): Prisma__DeviceClient<$Result.GetResult<Prisma.$DevicePayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Devices.
     * @param {DeviceDeleteManyArgs} args - Arguments to filter Devices to delete.
     * @example
     * // Delete a few Devices
     * const { count } = await prisma.device.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends DeviceDeleteManyArgs>(args?: SelectSubset<T, DeviceDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Devices.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {DeviceUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Devices
     * const device = await prisma.device.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends DeviceUpdateManyArgs>(args: SelectSubset<T, DeviceUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Device.
     * @param {DeviceUpsertArgs} args - Arguments to update or create a Device.
     * @example
     * // Update or create a Device
     * const device = await prisma.device.upsert({
     *   create: {
     *     // ... data to create a Device
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Device we want to update
     *   }
     * })
     */
    upsert<T extends DeviceUpsertArgs>(args: SelectSubset<T, DeviceUpsertArgs<ExtArgs>>): Prisma__DeviceClient<$Result.GetResult<Prisma.$DevicePayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Devices.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {DeviceCountArgs} args - Arguments to filter Devices to count.
     * @example
     * // Count the number of Devices
     * const count = await prisma.device.count({
     *   where: {
     *     // ... the filter for the Devices we want to count
     *   }
     * })
    **/
    count<T extends DeviceCountArgs>(
      args?: Subset<T, DeviceCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], DeviceCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Device.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {DeviceAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends DeviceAggregateArgs>(args: Subset<T, DeviceAggregateArgs>): Prisma.PrismaPromise<GetDeviceAggregateType<T>>

    /**
     * Group by Device.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {DeviceGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends DeviceGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: DeviceGroupByArgs['orderBy'] }
        : { orderBy?: DeviceGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, DeviceGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetDeviceGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Device model
   */
  readonly fields: DeviceFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Device.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__DeviceClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Device model
   */ 
  interface DeviceFieldRefs {
    readonly udid: FieldRef<"Device", 'String'>
    readonly host: FieldRef<"Device", 'String'>
    readonly systemPort: FieldRef<"Device", 'Int'>
    readonly proxyPort: FieldRef<"Device", 'Int'>
    readonly proxyHost: FieldRef<"Device", 'String'>
    readonly wdaLocalPort: FieldRef<"Device", 'Int'>
    readonly name: FieldRef<"Device", 'String'>
    readonly state: FieldRef<"Device", 'String'>
    readonly sdk: FieldRef<"Device", 'String'>
    readonly platform: FieldRef<"Device", 'String'>
    readonly deviceType: FieldRef<"Device", 'String'>
    readonly busy: FieldRef<"Device", 'Boolean'>
    readonly userBlocked: FieldRef<"Device", 'Boolean'>
    readonly realDevice: FieldRef<"Device", 'Boolean'>
    readonly session_id: FieldRef<"Device", 'String'>
    readonly offline: FieldRef<"Device", 'Boolean'>
    readonly mjpegServerPort: FieldRef<"Device", 'Int'>
    readonly lastCmdExecutedAt: FieldRef<"Device", 'Float'>
    readonly totalUtilizationTimeMilliSec: FieldRef<"Device", 'Float'>
    readonly sessionStartTime: FieldRef<"Device", 'Float'>
    readonly newCommandTimeout: FieldRef<"Device", 'Int'>
    readonly cloud: FieldRef<"Device", 'String'>
    readonly derivedDataPath: FieldRef<"Device", 'String'>
    readonly chromeDriverPath: FieldRef<"Device", 'String'>
    readonly capability: FieldRef<"Device", 'String'>
    readonly adbRemoteHost: FieldRef<"Device", 'String'>
    readonly adbPort: FieldRef<"Device", 'Int'>
    readonly nodeId: FieldRef<"Device", 'String'>
    readonly screenWidth: FieldRef<"Device", 'String'>
    readonly screenHeight: FieldRef<"Device", 'String'>
    readonly dashboard_link: FieldRef<"Device", 'String'>
    readonly total_session_count: FieldRef<"Device", 'Int'>
    readonly createdAt: FieldRef<"Device", 'DateTime'>
    readonly updatedAt: FieldRef<"Device", 'DateTime'>
    readonly healthCheckError: FieldRef<"Device", 'String'>
    readonly healthStatus: FieldRef<"Device", 'String'>
    readonly lastHealthCheckAt: FieldRef<"Device", 'Float'>
    readonly batteryLevel: FieldRef<"Device", 'Int'>
    readonly reservationReason: FieldRef<"Device", 'String'>
    readonly reservedBy: FieldRef<"Device", 'String'>
    readonly reservedUntil: FieldRef<"Device", 'Float'>
    readonly storageFree: FieldRef<"Device", 'String'>
    readonly tags: FieldRef<"Device", 'String'>
    readonly thermalStatus: FieldRef<"Device", 'String'>
    readonly sessionProgress: FieldRef<"Device", 'String'>
    readonly totalHealedCount: FieldRef<"Device", 'Int'>
    readonly ip: FieldRef<"Device", 'String'>
    readonly cpuArchitecture: FieldRef<"Device", 'String'>
    readonly owning_session_id: FieldRef<"Device", 'String'>
    readonly locked_at: FieldRef<"Device", 'Float'>
  }
    

  // Custom InputTypes
  /**
   * Device findUnique
   */
  export type DeviceFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Device
     */
    select?: DeviceSelect<ExtArgs> | null
    /**
     * Filter, which Device to fetch.
     */
    where: DeviceWhereUniqueInput
  }

  /**
   * Device findUniqueOrThrow
   */
  export type DeviceFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Device
     */
    select?: DeviceSelect<ExtArgs> | null
    /**
     * Filter, which Device to fetch.
     */
    where: DeviceWhereUniqueInput
  }

  /**
   * Device findFirst
   */
  export type DeviceFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Device
     */
    select?: DeviceSelect<ExtArgs> | null
    /**
     * Filter, which Device to fetch.
     */
    where?: DeviceWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Devices to fetch.
     */
    orderBy?: DeviceOrderByWithRelationInput | DeviceOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Devices.
     */
    cursor?: DeviceWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Devices from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Devices.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Devices.
     */
    distinct?: DeviceScalarFieldEnum | DeviceScalarFieldEnum[]
  }

  /**
   * Device findFirstOrThrow
   */
  export type DeviceFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Device
     */
    select?: DeviceSelect<ExtArgs> | null
    /**
     * Filter, which Device to fetch.
     */
    where?: DeviceWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Devices to fetch.
     */
    orderBy?: DeviceOrderByWithRelationInput | DeviceOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Devices.
     */
    cursor?: DeviceWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Devices from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Devices.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Devices.
     */
    distinct?: DeviceScalarFieldEnum | DeviceScalarFieldEnum[]
  }

  /**
   * Device findMany
   */
  export type DeviceFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Device
     */
    select?: DeviceSelect<ExtArgs> | null
    /**
     * Filter, which Devices to fetch.
     */
    where?: DeviceWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Devices to fetch.
     */
    orderBy?: DeviceOrderByWithRelationInput | DeviceOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Devices.
     */
    cursor?: DeviceWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Devices from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Devices.
     */
    skip?: number
    distinct?: DeviceScalarFieldEnum | DeviceScalarFieldEnum[]
  }

  /**
   * Device create
   */
  export type DeviceCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Device
     */
    select?: DeviceSelect<ExtArgs> | null
    /**
     * The data needed to create a Device.
     */
    data: XOR<DeviceCreateInput, DeviceUncheckedCreateInput>
  }

  /**
   * Device createMany
   */
  export type DeviceCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Devices.
     */
    data: DeviceCreateManyInput | DeviceCreateManyInput[]
  }

  /**
   * Device createManyAndReturn
   */
  export type DeviceCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Device
     */
    select?: DeviceSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many Devices.
     */
    data: DeviceCreateManyInput | DeviceCreateManyInput[]
  }

  /**
   * Device update
   */
  export type DeviceUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Device
     */
    select?: DeviceSelect<ExtArgs> | null
    /**
     * The data needed to update a Device.
     */
    data: XOR<DeviceUpdateInput, DeviceUncheckedUpdateInput>
    /**
     * Choose, which Device to update.
     */
    where: DeviceWhereUniqueInput
  }

  /**
   * Device updateMany
   */
  export type DeviceUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Devices.
     */
    data: XOR<DeviceUpdateManyMutationInput, DeviceUncheckedUpdateManyInput>
    /**
     * Filter which Devices to update
     */
    where?: DeviceWhereInput
  }

  /**
   * Device upsert
   */
  export type DeviceUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Device
     */
    select?: DeviceSelect<ExtArgs> | null
    /**
     * The filter to search for the Device to update in case it exists.
     */
    where: DeviceWhereUniqueInput
    /**
     * In case the Device found by the `where` argument doesn't exist, create a new Device with this data.
     */
    create: XOR<DeviceCreateInput, DeviceUncheckedCreateInput>
    /**
     * In case the Device was found with the provided `where` argument, update it with this data.
     */
    update: XOR<DeviceUpdateInput, DeviceUncheckedUpdateInput>
  }

  /**
   * Device delete
   */
  export type DeviceDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Device
     */
    select?: DeviceSelect<ExtArgs> | null
    /**
     * Filter which Device to delete.
     */
    where: DeviceWhereUniqueInput
  }

  /**
   * Device deleteMany
   */
  export type DeviceDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Devices to delete
     */
    where?: DeviceWhereInput
  }

  /**
   * Device without action
   */
  export type DeviceDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Device
     */
    select?: DeviceSelect<ExtArgs> | null
  }


  /**
   * Model PendingSession
   */

  export type AggregatePendingSession = {
    _count: PendingSessionCountAggregateOutputType | null
    _avg: PendingSessionAvgAggregateOutputType | null
    _sum: PendingSessionSumAggregateOutputType | null
    _min: PendingSessionMinAggregateOutputType | null
    _max: PendingSessionMaxAggregateOutputType | null
  }

  export type PendingSessionAvgAggregateOutputType = {
    id: number | null
    createdAt: number | null
  }

  export type PendingSessionSumAggregateOutputType = {
    id: number | null
    createdAt: number | null
  }

  export type PendingSessionMinAggregateOutputType = {
    id: number | null
    capability_id: string | null
    capability: string | null
    createdAt: number | null
  }

  export type PendingSessionMaxAggregateOutputType = {
    id: number | null
    capability_id: string | null
    capability: string | null
    createdAt: number | null
  }

  export type PendingSessionCountAggregateOutputType = {
    id: number
    capability_id: number
    capability: number
    createdAt: number
    _all: number
  }


  export type PendingSessionAvgAggregateInputType = {
    id?: true
    createdAt?: true
  }

  export type PendingSessionSumAggregateInputType = {
    id?: true
    createdAt?: true
  }

  export type PendingSessionMinAggregateInputType = {
    id?: true
    capability_id?: true
    capability?: true
    createdAt?: true
  }

  export type PendingSessionMaxAggregateInputType = {
    id?: true
    capability_id?: true
    capability?: true
    createdAt?: true
  }

  export type PendingSessionCountAggregateInputType = {
    id?: true
    capability_id?: true
    capability?: true
    createdAt?: true
    _all?: true
  }

  export type PendingSessionAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which PendingSession to aggregate.
     */
    where?: PendingSessionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PendingSessions to fetch.
     */
    orderBy?: PendingSessionOrderByWithRelationInput | PendingSessionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: PendingSessionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PendingSessions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PendingSessions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned PendingSessions
    **/
    _count?: true | PendingSessionCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: PendingSessionAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: PendingSessionSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: PendingSessionMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: PendingSessionMaxAggregateInputType
  }

  export type GetPendingSessionAggregateType<T extends PendingSessionAggregateArgs> = {
        [P in keyof T & keyof AggregatePendingSession]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregatePendingSession[P]>
      : GetScalarType<T[P], AggregatePendingSession[P]>
  }




  export type PendingSessionGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: PendingSessionWhereInput
    orderBy?: PendingSessionOrderByWithAggregationInput | PendingSessionOrderByWithAggregationInput[]
    by: PendingSessionScalarFieldEnum[] | PendingSessionScalarFieldEnum
    having?: PendingSessionScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: PendingSessionCountAggregateInputType | true
    _avg?: PendingSessionAvgAggregateInputType
    _sum?: PendingSessionSumAggregateInputType
    _min?: PendingSessionMinAggregateInputType
    _max?: PendingSessionMaxAggregateInputType
  }

  export type PendingSessionGroupByOutputType = {
    id: number
    capability_id: string
    capability: string
    createdAt: number
    _count: PendingSessionCountAggregateOutputType | null
    _avg: PendingSessionAvgAggregateOutputType | null
    _sum: PendingSessionSumAggregateOutputType | null
    _min: PendingSessionMinAggregateOutputType | null
    _max: PendingSessionMaxAggregateOutputType | null
  }

  type GetPendingSessionGroupByPayload<T extends PendingSessionGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<PendingSessionGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof PendingSessionGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], PendingSessionGroupByOutputType[P]>
            : GetScalarType<T[P], PendingSessionGroupByOutputType[P]>
        }
      >
    >


  export type PendingSessionSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    capability_id?: boolean
    capability?: boolean
    createdAt?: boolean
  }, ExtArgs["result"]["pendingSession"]>

  export type PendingSessionSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    capability_id?: boolean
    capability?: boolean
    createdAt?: boolean
  }, ExtArgs["result"]["pendingSession"]>

  export type PendingSessionSelectScalar = {
    id?: boolean
    capability_id?: boolean
    capability?: boolean
    createdAt?: boolean
  }


  export type $PendingSessionPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "PendingSession"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: number
      capability_id: string
      capability: string
      createdAt: number
    }, ExtArgs["result"]["pendingSession"]>
    composites: {}
  }

  type PendingSessionGetPayload<S extends boolean | null | undefined | PendingSessionDefaultArgs> = $Result.GetResult<Prisma.$PendingSessionPayload, S>

  type PendingSessionCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<PendingSessionFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: PendingSessionCountAggregateInputType | true
    }

  export interface PendingSessionDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['PendingSession'], meta: { name: 'PendingSession' } }
    /**
     * Find zero or one PendingSession that matches the filter.
     * @param {PendingSessionFindUniqueArgs} args - Arguments to find a PendingSession
     * @example
     * // Get one PendingSession
     * const pendingSession = await prisma.pendingSession.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends PendingSessionFindUniqueArgs>(args: SelectSubset<T, PendingSessionFindUniqueArgs<ExtArgs>>): Prisma__PendingSessionClient<$Result.GetResult<Prisma.$PendingSessionPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one PendingSession that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {PendingSessionFindUniqueOrThrowArgs} args - Arguments to find a PendingSession
     * @example
     * // Get one PendingSession
     * const pendingSession = await prisma.pendingSession.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends PendingSessionFindUniqueOrThrowArgs>(args: SelectSubset<T, PendingSessionFindUniqueOrThrowArgs<ExtArgs>>): Prisma__PendingSessionClient<$Result.GetResult<Prisma.$PendingSessionPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first PendingSession that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PendingSessionFindFirstArgs} args - Arguments to find a PendingSession
     * @example
     * // Get one PendingSession
     * const pendingSession = await prisma.pendingSession.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends PendingSessionFindFirstArgs>(args?: SelectSubset<T, PendingSessionFindFirstArgs<ExtArgs>>): Prisma__PendingSessionClient<$Result.GetResult<Prisma.$PendingSessionPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first PendingSession that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PendingSessionFindFirstOrThrowArgs} args - Arguments to find a PendingSession
     * @example
     * // Get one PendingSession
     * const pendingSession = await prisma.pendingSession.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends PendingSessionFindFirstOrThrowArgs>(args?: SelectSubset<T, PendingSessionFindFirstOrThrowArgs<ExtArgs>>): Prisma__PendingSessionClient<$Result.GetResult<Prisma.$PendingSessionPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more PendingSessions that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PendingSessionFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all PendingSessions
     * const pendingSessions = await prisma.pendingSession.findMany()
     * 
     * // Get first 10 PendingSessions
     * const pendingSessions = await prisma.pendingSession.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const pendingSessionWithIdOnly = await prisma.pendingSession.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends PendingSessionFindManyArgs>(args?: SelectSubset<T, PendingSessionFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PendingSessionPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a PendingSession.
     * @param {PendingSessionCreateArgs} args - Arguments to create a PendingSession.
     * @example
     * // Create one PendingSession
     * const PendingSession = await prisma.pendingSession.create({
     *   data: {
     *     // ... data to create a PendingSession
     *   }
     * })
     * 
     */
    create<T extends PendingSessionCreateArgs>(args: SelectSubset<T, PendingSessionCreateArgs<ExtArgs>>): Prisma__PendingSessionClient<$Result.GetResult<Prisma.$PendingSessionPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many PendingSessions.
     * @param {PendingSessionCreateManyArgs} args - Arguments to create many PendingSessions.
     * @example
     * // Create many PendingSessions
     * const pendingSession = await prisma.pendingSession.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends PendingSessionCreateManyArgs>(args?: SelectSubset<T, PendingSessionCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many PendingSessions and returns the data saved in the database.
     * @param {PendingSessionCreateManyAndReturnArgs} args - Arguments to create many PendingSessions.
     * @example
     * // Create many PendingSessions
     * const pendingSession = await prisma.pendingSession.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many PendingSessions and only return the `id`
     * const pendingSessionWithIdOnly = await prisma.pendingSession.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends PendingSessionCreateManyAndReturnArgs>(args?: SelectSubset<T, PendingSessionCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PendingSessionPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a PendingSession.
     * @param {PendingSessionDeleteArgs} args - Arguments to delete one PendingSession.
     * @example
     * // Delete one PendingSession
     * const PendingSession = await prisma.pendingSession.delete({
     *   where: {
     *     // ... filter to delete one PendingSession
     *   }
     * })
     * 
     */
    delete<T extends PendingSessionDeleteArgs>(args: SelectSubset<T, PendingSessionDeleteArgs<ExtArgs>>): Prisma__PendingSessionClient<$Result.GetResult<Prisma.$PendingSessionPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one PendingSession.
     * @param {PendingSessionUpdateArgs} args - Arguments to update one PendingSession.
     * @example
     * // Update one PendingSession
     * const pendingSession = await prisma.pendingSession.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends PendingSessionUpdateArgs>(args: SelectSubset<T, PendingSessionUpdateArgs<ExtArgs>>): Prisma__PendingSessionClient<$Result.GetResult<Prisma.$PendingSessionPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more PendingSessions.
     * @param {PendingSessionDeleteManyArgs} args - Arguments to filter PendingSessions to delete.
     * @example
     * // Delete a few PendingSessions
     * const { count } = await prisma.pendingSession.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends PendingSessionDeleteManyArgs>(args?: SelectSubset<T, PendingSessionDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more PendingSessions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PendingSessionUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many PendingSessions
     * const pendingSession = await prisma.pendingSession.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends PendingSessionUpdateManyArgs>(args: SelectSubset<T, PendingSessionUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one PendingSession.
     * @param {PendingSessionUpsertArgs} args - Arguments to update or create a PendingSession.
     * @example
     * // Update or create a PendingSession
     * const pendingSession = await prisma.pendingSession.upsert({
     *   create: {
     *     // ... data to create a PendingSession
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the PendingSession we want to update
     *   }
     * })
     */
    upsert<T extends PendingSessionUpsertArgs>(args: SelectSubset<T, PendingSessionUpsertArgs<ExtArgs>>): Prisma__PendingSessionClient<$Result.GetResult<Prisma.$PendingSessionPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of PendingSessions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PendingSessionCountArgs} args - Arguments to filter PendingSessions to count.
     * @example
     * // Count the number of PendingSessions
     * const count = await prisma.pendingSession.count({
     *   where: {
     *     // ... the filter for the PendingSessions we want to count
     *   }
     * })
    **/
    count<T extends PendingSessionCountArgs>(
      args?: Subset<T, PendingSessionCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], PendingSessionCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a PendingSession.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PendingSessionAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends PendingSessionAggregateArgs>(args: Subset<T, PendingSessionAggregateArgs>): Prisma.PrismaPromise<GetPendingSessionAggregateType<T>>

    /**
     * Group by PendingSession.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PendingSessionGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends PendingSessionGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: PendingSessionGroupByArgs['orderBy'] }
        : { orderBy?: PendingSessionGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, PendingSessionGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetPendingSessionGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the PendingSession model
   */
  readonly fields: PendingSessionFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for PendingSession.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__PendingSessionClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the PendingSession model
   */ 
  interface PendingSessionFieldRefs {
    readonly id: FieldRef<"PendingSession", 'Int'>
    readonly capability_id: FieldRef<"PendingSession", 'String'>
    readonly capability: FieldRef<"PendingSession", 'String'>
    readonly createdAt: FieldRef<"PendingSession", 'Float'>
  }
    

  // Custom InputTypes
  /**
   * PendingSession findUnique
   */
  export type PendingSessionFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PendingSession
     */
    select?: PendingSessionSelect<ExtArgs> | null
    /**
     * Filter, which PendingSession to fetch.
     */
    where: PendingSessionWhereUniqueInput
  }

  /**
   * PendingSession findUniqueOrThrow
   */
  export type PendingSessionFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PendingSession
     */
    select?: PendingSessionSelect<ExtArgs> | null
    /**
     * Filter, which PendingSession to fetch.
     */
    where: PendingSessionWhereUniqueInput
  }

  /**
   * PendingSession findFirst
   */
  export type PendingSessionFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PendingSession
     */
    select?: PendingSessionSelect<ExtArgs> | null
    /**
     * Filter, which PendingSession to fetch.
     */
    where?: PendingSessionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PendingSessions to fetch.
     */
    orderBy?: PendingSessionOrderByWithRelationInput | PendingSessionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for PendingSessions.
     */
    cursor?: PendingSessionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PendingSessions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PendingSessions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of PendingSessions.
     */
    distinct?: PendingSessionScalarFieldEnum | PendingSessionScalarFieldEnum[]
  }

  /**
   * PendingSession findFirstOrThrow
   */
  export type PendingSessionFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PendingSession
     */
    select?: PendingSessionSelect<ExtArgs> | null
    /**
     * Filter, which PendingSession to fetch.
     */
    where?: PendingSessionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PendingSessions to fetch.
     */
    orderBy?: PendingSessionOrderByWithRelationInput | PendingSessionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for PendingSessions.
     */
    cursor?: PendingSessionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PendingSessions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PendingSessions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of PendingSessions.
     */
    distinct?: PendingSessionScalarFieldEnum | PendingSessionScalarFieldEnum[]
  }

  /**
   * PendingSession findMany
   */
  export type PendingSessionFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PendingSession
     */
    select?: PendingSessionSelect<ExtArgs> | null
    /**
     * Filter, which PendingSessions to fetch.
     */
    where?: PendingSessionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PendingSessions to fetch.
     */
    orderBy?: PendingSessionOrderByWithRelationInput | PendingSessionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing PendingSessions.
     */
    cursor?: PendingSessionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PendingSessions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PendingSessions.
     */
    skip?: number
    distinct?: PendingSessionScalarFieldEnum | PendingSessionScalarFieldEnum[]
  }

  /**
   * PendingSession create
   */
  export type PendingSessionCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PendingSession
     */
    select?: PendingSessionSelect<ExtArgs> | null
    /**
     * The data needed to create a PendingSession.
     */
    data: XOR<PendingSessionCreateInput, PendingSessionUncheckedCreateInput>
  }

  /**
   * PendingSession createMany
   */
  export type PendingSessionCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many PendingSessions.
     */
    data: PendingSessionCreateManyInput | PendingSessionCreateManyInput[]
  }

  /**
   * PendingSession createManyAndReturn
   */
  export type PendingSessionCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PendingSession
     */
    select?: PendingSessionSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many PendingSessions.
     */
    data: PendingSessionCreateManyInput | PendingSessionCreateManyInput[]
  }

  /**
   * PendingSession update
   */
  export type PendingSessionUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PendingSession
     */
    select?: PendingSessionSelect<ExtArgs> | null
    /**
     * The data needed to update a PendingSession.
     */
    data: XOR<PendingSessionUpdateInput, PendingSessionUncheckedUpdateInput>
    /**
     * Choose, which PendingSession to update.
     */
    where: PendingSessionWhereUniqueInput
  }

  /**
   * PendingSession updateMany
   */
  export type PendingSessionUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update PendingSessions.
     */
    data: XOR<PendingSessionUpdateManyMutationInput, PendingSessionUncheckedUpdateManyInput>
    /**
     * Filter which PendingSessions to update
     */
    where?: PendingSessionWhereInput
  }

  /**
   * PendingSession upsert
   */
  export type PendingSessionUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PendingSession
     */
    select?: PendingSessionSelect<ExtArgs> | null
    /**
     * The filter to search for the PendingSession to update in case it exists.
     */
    where: PendingSessionWhereUniqueInput
    /**
     * In case the PendingSession found by the `where` argument doesn't exist, create a new PendingSession with this data.
     */
    create: XOR<PendingSessionCreateInput, PendingSessionUncheckedCreateInput>
    /**
     * In case the PendingSession was found with the provided `where` argument, update it with this data.
     */
    update: XOR<PendingSessionUpdateInput, PendingSessionUncheckedUpdateInput>
  }

  /**
   * PendingSession delete
   */
  export type PendingSessionDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PendingSession
     */
    select?: PendingSessionSelect<ExtArgs> | null
    /**
     * Filter which PendingSession to delete.
     */
    where: PendingSessionWhereUniqueInput
  }

  /**
   * PendingSession deleteMany
   */
  export type PendingSessionDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which PendingSessions to delete
     */
    where?: PendingSessionWhereInput
  }

  /**
   * PendingSession without action
   */
  export type PendingSessionDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PendingSession
     */
    select?: PendingSessionSelect<ExtArgs> | null
  }


  /**
   * Model CLIArgs
   */

  export type AggregateCLIArgs = {
    _count: CLIArgsCountAggregateOutputType | null
    _avg: CLIArgsAvgAggregateOutputType | null
    _sum: CLIArgsSumAggregateOutputType | null
    _min: CLIArgsMinAggregateOutputType | null
    _max: CLIArgsMaxAggregateOutputType | null
  }

  export type CLIArgsAvgAggregateOutputType = {
    id: number | null
  }

  export type CLIArgsSumAggregateOutputType = {
    id: number | null
  }

  export type CLIArgsMinAggregateOutputType = {
    id: number | null
    args: string | null
    createdAt: Date | null
  }

  export type CLIArgsMaxAggregateOutputType = {
    id: number | null
    args: string | null
    createdAt: Date | null
  }

  export type CLIArgsCountAggregateOutputType = {
    id: number
    args: number
    createdAt: number
    _all: number
  }


  export type CLIArgsAvgAggregateInputType = {
    id?: true
  }

  export type CLIArgsSumAggregateInputType = {
    id?: true
  }

  export type CLIArgsMinAggregateInputType = {
    id?: true
    args?: true
    createdAt?: true
  }

  export type CLIArgsMaxAggregateInputType = {
    id?: true
    args?: true
    createdAt?: true
  }

  export type CLIArgsCountAggregateInputType = {
    id?: true
    args?: true
    createdAt?: true
    _all?: true
  }

  export type CLIArgsAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which CLIArgs to aggregate.
     */
    where?: CLIArgsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of CLIArgs to fetch.
     */
    orderBy?: CLIArgsOrderByWithRelationInput | CLIArgsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: CLIArgsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` CLIArgs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` CLIArgs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned CLIArgs
    **/
    _count?: true | CLIArgsCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: CLIArgsAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: CLIArgsSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: CLIArgsMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: CLIArgsMaxAggregateInputType
  }

  export type GetCLIArgsAggregateType<T extends CLIArgsAggregateArgs> = {
        [P in keyof T & keyof AggregateCLIArgs]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateCLIArgs[P]>
      : GetScalarType<T[P], AggregateCLIArgs[P]>
  }




  export type CLIArgsGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: CLIArgsWhereInput
    orderBy?: CLIArgsOrderByWithAggregationInput | CLIArgsOrderByWithAggregationInput[]
    by: CLIArgsScalarFieldEnum[] | CLIArgsScalarFieldEnum
    having?: CLIArgsScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: CLIArgsCountAggregateInputType | true
    _avg?: CLIArgsAvgAggregateInputType
    _sum?: CLIArgsSumAggregateInputType
    _min?: CLIArgsMinAggregateInputType
    _max?: CLIArgsMaxAggregateInputType
  }

  export type CLIArgsGroupByOutputType = {
    id: number
    args: string
    createdAt: Date
    _count: CLIArgsCountAggregateOutputType | null
    _avg: CLIArgsAvgAggregateOutputType | null
    _sum: CLIArgsSumAggregateOutputType | null
    _min: CLIArgsMinAggregateOutputType | null
    _max: CLIArgsMaxAggregateOutputType | null
  }

  type GetCLIArgsGroupByPayload<T extends CLIArgsGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<CLIArgsGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof CLIArgsGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], CLIArgsGroupByOutputType[P]>
            : GetScalarType<T[P], CLIArgsGroupByOutputType[P]>
        }
      >
    >


  export type CLIArgsSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    args?: boolean
    createdAt?: boolean
  }, ExtArgs["result"]["cLIArgs"]>

  export type CLIArgsSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    args?: boolean
    createdAt?: boolean
  }, ExtArgs["result"]["cLIArgs"]>

  export type CLIArgsSelectScalar = {
    id?: boolean
    args?: boolean
    createdAt?: boolean
  }


  export type $CLIArgsPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "CLIArgs"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: number
      args: string
      createdAt: Date
    }, ExtArgs["result"]["cLIArgs"]>
    composites: {}
  }

  type CLIArgsGetPayload<S extends boolean | null | undefined | CLIArgsDefaultArgs> = $Result.GetResult<Prisma.$CLIArgsPayload, S>

  type CLIArgsCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<CLIArgsFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: CLIArgsCountAggregateInputType | true
    }

  export interface CLIArgsDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['CLIArgs'], meta: { name: 'CLIArgs' } }
    /**
     * Find zero or one CLIArgs that matches the filter.
     * @param {CLIArgsFindUniqueArgs} args - Arguments to find a CLIArgs
     * @example
     * // Get one CLIArgs
     * const cLIArgs = await prisma.cLIArgs.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends CLIArgsFindUniqueArgs>(args: SelectSubset<T, CLIArgsFindUniqueArgs<ExtArgs>>): Prisma__CLIArgsClient<$Result.GetResult<Prisma.$CLIArgsPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one CLIArgs that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {CLIArgsFindUniqueOrThrowArgs} args - Arguments to find a CLIArgs
     * @example
     * // Get one CLIArgs
     * const cLIArgs = await prisma.cLIArgs.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends CLIArgsFindUniqueOrThrowArgs>(args: SelectSubset<T, CLIArgsFindUniqueOrThrowArgs<ExtArgs>>): Prisma__CLIArgsClient<$Result.GetResult<Prisma.$CLIArgsPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first CLIArgs that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CLIArgsFindFirstArgs} args - Arguments to find a CLIArgs
     * @example
     * // Get one CLIArgs
     * const cLIArgs = await prisma.cLIArgs.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends CLIArgsFindFirstArgs>(args?: SelectSubset<T, CLIArgsFindFirstArgs<ExtArgs>>): Prisma__CLIArgsClient<$Result.GetResult<Prisma.$CLIArgsPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first CLIArgs that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CLIArgsFindFirstOrThrowArgs} args - Arguments to find a CLIArgs
     * @example
     * // Get one CLIArgs
     * const cLIArgs = await prisma.cLIArgs.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends CLIArgsFindFirstOrThrowArgs>(args?: SelectSubset<T, CLIArgsFindFirstOrThrowArgs<ExtArgs>>): Prisma__CLIArgsClient<$Result.GetResult<Prisma.$CLIArgsPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more CLIArgs that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CLIArgsFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all CLIArgs
     * const cLIArgs = await prisma.cLIArgs.findMany()
     * 
     * // Get first 10 CLIArgs
     * const cLIArgs = await prisma.cLIArgs.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const cLIArgsWithIdOnly = await prisma.cLIArgs.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends CLIArgsFindManyArgs>(args?: SelectSubset<T, CLIArgsFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$CLIArgsPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a CLIArgs.
     * @param {CLIArgsCreateArgs} args - Arguments to create a CLIArgs.
     * @example
     * // Create one CLIArgs
     * const CLIArgs = await prisma.cLIArgs.create({
     *   data: {
     *     // ... data to create a CLIArgs
     *   }
     * })
     * 
     */
    create<T extends CLIArgsCreateArgs>(args: SelectSubset<T, CLIArgsCreateArgs<ExtArgs>>): Prisma__CLIArgsClient<$Result.GetResult<Prisma.$CLIArgsPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many CLIArgs.
     * @param {CLIArgsCreateManyArgs} args - Arguments to create many CLIArgs.
     * @example
     * // Create many CLIArgs
     * const cLIArgs = await prisma.cLIArgs.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends CLIArgsCreateManyArgs>(args?: SelectSubset<T, CLIArgsCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many CLIArgs and returns the data saved in the database.
     * @param {CLIArgsCreateManyAndReturnArgs} args - Arguments to create many CLIArgs.
     * @example
     * // Create many CLIArgs
     * const cLIArgs = await prisma.cLIArgs.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many CLIArgs and only return the `id`
     * const cLIArgsWithIdOnly = await prisma.cLIArgs.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends CLIArgsCreateManyAndReturnArgs>(args?: SelectSubset<T, CLIArgsCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$CLIArgsPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a CLIArgs.
     * @param {CLIArgsDeleteArgs} args - Arguments to delete one CLIArgs.
     * @example
     * // Delete one CLIArgs
     * const CLIArgs = await prisma.cLIArgs.delete({
     *   where: {
     *     // ... filter to delete one CLIArgs
     *   }
     * })
     * 
     */
    delete<T extends CLIArgsDeleteArgs>(args: SelectSubset<T, CLIArgsDeleteArgs<ExtArgs>>): Prisma__CLIArgsClient<$Result.GetResult<Prisma.$CLIArgsPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one CLIArgs.
     * @param {CLIArgsUpdateArgs} args - Arguments to update one CLIArgs.
     * @example
     * // Update one CLIArgs
     * const cLIArgs = await prisma.cLIArgs.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends CLIArgsUpdateArgs>(args: SelectSubset<T, CLIArgsUpdateArgs<ExtArgs>>): Prisma__CLIArgsClient<$Result.GetResult<Prisma.$CLIArgsPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more CLIArgs.
     * @param {CLIArgsDeleteManyArgs} args - Arguments to filter CLIArgs to delete.
     * @example
     * // Delete a few CLIArgs
     * const { count } = await prisma.cLIArgs.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends CLIArgsDeleteManyArgs>(args?: SelectSubset<T, CLIArgsDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more CLIArgs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CLIArgsUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many CLIArgs
     * const cLIArgs = await prisma.cLIArgs.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends CLIArgsUpdateManyArgs>(args: SelectSubset<T, CLIArgsUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one CLIArgs.
     * @param {CLIArgsUpsertArgs} args - Arguments to update or create a CLIArgs.
     * @example
     * // Update or create a CLIArgs
     * const cLIArgs = await prisma.cLIArgs.upsert({
     *   create: {
     *     // ... data to create a CLIArgs
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the CLIArgs we want to update
     *   }
     * })
     */
    upsert<T extends CLIArgsUpsertArgs>(args: SelectSubset<T, CLIArgsUpsertArgs<ExtArgs>>): Prisma__CLIArgsClient<$Result.GetResult<Prisma.$CLIArgsPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of CLIArgs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CLIArgsCountArgs} args - Arguments to filter CLIArgs to count.
     * @example
     * // Count the number of CLIArgs
     * const count = await prisma.cLIArgs.count({
     *   where: {
     *     // ... the filter for the CLIArgs we want to count
     *   }
     * })
    **/
    count<T extends CLIArgsCountArgs>(
      args?: Subset<T, CLIArgsCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], CLIArgsCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a CLIArgs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CLIArgsAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends CLIArgsAggregateArgs>(args: Subset<T, CLIArgsAggregateArgs>): Prisma.PrismaPromise<GetCLIArgsAggregateType<T>>

    /**
     * Group by CLIArgs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CLIArgsGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends CLIArgsGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: CLIArgsGroupByArgs['orderBy'] }
        : { orderBy?: CLIArgsGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, CLIArgsGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetCLIArgsGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the CLIArgs model
   */
  readonly fields: CLIArgsFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for CLIArgs.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__CLIArgsClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the CLIArgs model
   */ 
  interface CLIArgsFieldRefs {
    readonly id: FieldRef<"CLIArgs", 'Int'>
    readonly args: FieldRef<"CLIArgs", 'String'>
    readonly createdAt: FieldRef<"CLIArgs", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * CLIArgs findUnique
   */
  export type CLIArgsFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CLIArgs
     */
    select?: CLIArgsSelect<ExtArgs> | null
    /**
     * Filter, which CLIArgs to fetch.
     */
    where: CLIArgsWhereUniqueInput
  }

  /**
   * CLIArgs findUniqueOrThrow
   */
  export type CLIArgsFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CLIArgs
     */
    select?: CLIArgsSelect<ExtArgs> | null
    /**
     * Filter, which CLIArgs to fetch.
     */
    where: CLIArgsWhereUniqueInput
  }

  /**
   * CLIArgs findFirst
   */
  export type CLIArgsFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CLIArgs
     */
    select?: CLIArgsSelect<ExtArgs> | null
    /**
     * Filter, which CLIArgs to fetch.
     */
    where?: CLIArgsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of CLIArgs to fetch.
     */
    orderBy?: CLIArgsOrderByWithRelationInput | CLIArgsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for CLIArgs.
     */
    cursor?: CLIArgsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` CLIArgs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` CLIArgs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of CLIArgs.
     */
    distinct?: CLIArgsScalarFieldEnum | CLIArgsScalarFieldEnum[]
  }

  /**
   * CLIArgs findFirstOrThrow
   */
  export type CLIArgsFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CLIArgs
     */
    select?: CLIArgsSelect<ExtArgs> | null
    /**
     * Filter, which CLIArgs to fetch.
     */
    where?: CLIArgsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of CLIArgs to fetch.
     */
    orderBy?: CLIArgsOrderByWithRelationInput | CLIArgsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for CLIArgs.
     */
    cursor?: CLIArgsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` CLIArgs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` CLIArgs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of CLIArgs.
     */
    distinct?: CLIArgsScalarFieldEnum | CLIArgsScalarFieldEnum[]
  }

  /**
   * CLIArgs findMany
   */
  export type CLIArgsFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CLIArgs
     */
    select?: CLIArgsSelect<ExtArgs> | null
    /**
     * Filter, which CLIArgs to fetch.
     */
    where?: CLIArgsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of CLIArgs to fetch.
     */
    orderBy?: CLIArgsOrderByWithRelationInput | CLIArgsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing CLIArgs.
     */
    cursor?: CLIArgsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` CLIArgs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` CLIArgs.
     */
    skip?: number
    distinct?: CLIArgsScalarFieldEnum | CLIArgsScalarFieldEnum[]
  }

  /**
   * CLIArgs create
   */
  export type CLIArgsCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CLIArgs
     */
    select?: CLIArgsSelect<ExtArgs> | null
    /**
     * The data needed to create a CLIArgs.
     */
    data: XOR<CLIArgsCreateInput, CLIArgsUncheckedCreateInput>
  }

  /**
   * CLIArgs createMany
   */
  export type CLIArgsCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many CLIArgs.
     */
    data: CLIArgsCreateManyInput | CLIArgsCreateManyInput[]
  }

  /**
   * CLIArgs createManyAndReturn
   */
  export type CLIArgsCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CLIArgs
     */
    select?: CLIArgsSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many CLIArgs.
     */
    data: CLIArgsCreateManyInput | CLIArgsCreateManyInput[]
  }

  /**
   * CLIArgs update
   */
  export type CLIArgsUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CLIArgs
     */
    select?: CLIArgsSelect<ExtArgs> | null
    /**
     * The data needed to update a CLIArgs.
     */
    data: XOR<CLIArgsUpdateInput, CLIArgsUncheckedUpdateInput>
    /**
     * Choose, which CLIArgs to update.
     */
    where: CLIArgsWhereUniqueInput
  }

  /**
   * CLIArgs updateMany
   */
  export type CLIArgsUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update CLIArgs.
     */
    data: XOR<CLIArgsUpdateManyMutationInput, CLIArgsUncheckedUpdateManyInput>
    /**
     * Filter which CLIArgs to update
     */
    where?: CLIArgsWhereInput
  }

  /**
   * CLIArgs upsert
   */
  export type CLIArgsUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CLIArgs
     */
    select?: CLIArgsSelect<ExtArgs> | null
    /**
     * The filter to search for the CLIArgs to update in case it exists.
     */
    where: CLIArgsWhereUniqueInput
    /**
     * In case the CLIArgs found by the `where` argument doesn't exist, create a new CLIArgs with this data.
     */
    create: XOR<CLIArgsCreateInput, CLIArgsUncheckedCreateInput>
    /**
     * In case the CLIArgs was found with the provided `where` argument, update it with this data.
     */
    update: XOR<CLIArgsUpdateInput, CLIArgsUncheckedUpdateInput>
  }

  /**
   * CLIArgs delete
   */
  export type CLIArgsDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CLIArgs
     */
    select?: CLIArgsSelect<ExtArgs> | null
    /**
     * Filter which CLIArgs to delete.
     */
    where: CLIArgsWhereUniqueInput
  }

  /**
   * CLIArgs deleteMany
   */
  export type CLIArgsDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which CLIArgs to delete
     */
    where?: CLIArgsWhereInput
  }

  /**
   * CLIArgs without action
   */
  export type CLIArgsDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CLIArgs
     */
    select?: CLIArgsSelect<ExtArgs> | null
  }


  /**
   * Model WebhookConfig
   */

  export type AggregateWebhookConfig = {
    _count: WebhookConfigCountAggregateOutputType | null
    _min: WebhookConfigMinAggregateOutputType | null
    _max: WebhookConfigMaxAggregateOutputType | null
  }

  export type WebhookConfigMinAggregateOutputType = {
    id: string | null
    url: string | null
    type: string | null
    events: string | null
    active: boolean | null
    createdAt: Date | null
    updatedAt: Date | null
    payloadTemplate: string | null
  }

  export type WebhookConfigMaxAggregateOutputType = {
    id: string | null
    url: string | null
    type: string | null
    events: string | null
    active: boolean | null
    createdAt: Date | null
    updatedAt: Date | null
    payloadTemplate: string | null
  }

  export type WebhookConfigCountAggregateOutputType = {
    id: number
    url: number
    type: number
    events: number
    active: number
    createdAt: number
    updatedAt: number
    payloadTemplate: number
    _all: number
  }


  export type WebhookConfigMinAggregateInputType = {
    id?: true
    url?: true
    type?: true
    events?: true
    active?: true
    createdAt?: true
    updatedAt?: true
    payloadTemplate?: true
  }

  export type WebhookConfigMaxAggregateInputType = {
    id?: true
    url?: true
    type?: true
    events?: true
    active?: true
    createdAt?: true
    updatedAt?: true
    payloadTemplate?: true
  }

  export type WebhookConfigCountAggregateInputType = {
    id?: true
    url?: true
    type?: true
    events?: true
    active?: true
    createdAt?: true
    updatedAt?: true
    payloadTemplate?: true
    _all?: true
  }

  export type WebhookConfigAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which WebhookConfig to aggregate.
     */
    where?: WebhookConfigWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WebhookConfigs to fetch.
     */
    orderBy?: WebhookConfigOrderByWithRelationInput | WebhookConfigOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: WebhookConfigWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WebhookConfigs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WebhookConfigs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned WebhookConfigs
    **/
    _count?: true | WebhookConfigCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: WebhookConfigMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: WebhookConfigMaxAggregateInputType
  }

  export type GetWebhookConfigAggregateType<T extends WebhookConfigAggregateArgs> = {
        [P in keyof T & keyof AggregateWebhookConfig]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateWebhookConfig[P]>
      : GetScalarType<T[P], AggregateWebhookConfig[P]>
  }




  export type WebhookConfigGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: WebhookConfigWhereInput
    orderBy?: WebhookConfigOrderByWithAggregationInput | WebhookConfigOrderByWithAggregationInput[]
    by: WebhookConfigScalarFieldEnum[] | WebhookConfigScalarFieldEnum
    having?: WebhookConfigScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: WebhookConfigCountAggregateInputType | true
    _min?: WebhookConfigMinAggregateInputType
    _max?: WebhookConfigMaxAggregateInputType
  }

  export type WebhookConfigGroupByOutputType = {
    id: string
    url: string
    type: string
    events: string
    active: boolean
    createdAt: Date
    updatedAt: Date
    payloadTemplate: string | null
    _count: WebhookConfigCountAggregateOutputType | null
    _min: WebhookConfigMinAggregateOutputType | null
    _max: WebhookConfigMaxAggregateOutputType | null
  }

  type GetWebhookConfigGroupByPayload<T extends WebhookConfigGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<WebhookConfigGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof WebhookConfigGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], WebhookConfigGroupByOutputType[P]>
            : GetScalarType<T[P], WebhookConfigGroupByOutputType[P]>
        }
      >
    >


  export type WebhookConfigSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    url?: boolean
    type?: boolean
    events?: boolean
    active?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    payloadTemplate?: boolean
  }, ExtArgs["result"]["webhookConfig"]>

  export type WebhookConfigSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    url?: boolean
    type?: boolean
    events?: boolean
    active?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    payloadTemplate?: boolean
  }, ExtArgs["result"]["webhookConfig"]>

  export type WebhookConfigSelectScalar = {
    id?: boolean
    url?: boolean
    type?: boolean
    events?: boolean
    active?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    payloadTemplate?: boolean
  }


  export type $WebhookConfigPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "WebhookConfig"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      url: string
      type: string
      events: string
      active: boolean
      createdAt: Date
      updatedAt: Date
      payloadTemplate: string | null
    }, ExtArgs["result"]["webhookConfig"]>
    composites: {}
  }

  type WebhookConfigGetPayload<S extends boolean | null | undefined | WebhookConfigDefaultArgs> = $Result.GetResult<Prisma.$WebhookConfigPayload, S>

  type WebhookConfigCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<WebhookConfigFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: WebhookConfigCountAggregateInputType | true
    }

  export interface WebhookConfigDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['WebhookConfig'], meta: { name: 'WebhookConfig' } }
    /**
     * Find zero or one WebhookConfig that matches the filter.
     * @param {WebhookConfigFindUniqueArgs} args - Arguments to find a WebhookConfig
     * @example
     * // Get one WebhookConfig
     * const webhookConfig = await prisma.webhookConfig.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends WebhookConfigFindUniqueArgs>(args: SelectSubset<T, WebhookConfigFindUniqueArgs<ExtArgs>>): Prisma__WebhookConfigClient<$Result.GetResult<Prisma.$WebhookConfigPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one WebhookConfig that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {WebhookConfigFindUniqueOrThrowArgs} args - Arguments to find a WebhookConfig
     * @example
     * // Get one WebhookConfig
     * const webhookConfig = await prisma.webhookConfig.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends WebhookConfigFindUniqueOrThrowArgs>(args: SelectSubset<T, WebhookConfigFindUniqueOrThrowArgs<ExtArgs>>): Prisma__WebhookConfigClient<$Result.GetResult<Prisma.$WebhookConfigPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first WebhookConfig that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WebhookConfigFindFirstArgs} args - Arguments to find a WebhookConfig
     * @example
     * // Get one WebhookConfig
     * const webhookConfig = await prisma.webhookConfig.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends WebhookConfigFindFirstArgs>(args?: SelectSubset<T, WebhookConfigFindFirstArgs<ExtArgs>>): Prisma__WebhookConfigClient<$Result.GetResult<Prisma.$WebhookConfigPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first WebhookConfig that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WebhookConfigFindFirstOrThrowArgs} args - Arguments to find a WebhookConfig
     * @example
     * // Get one WebhookConfig
     * const webhookConfig = await prisma.webhookConfig.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends WebhookConfigFindFirstOrThrowArgs>(args?: SelectSubset<T, WebhookConfigFindFirstOrThrowArgs<ExtArgs>>): Prisma__WebhookConfigClient<$Result.GetResult<Prisma.$WebhookConfigPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more WebhookConfigs that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WebhookConfigFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all WebhookConfigs
     * const webhookConfigs = await prisma.webhookConfig.findMany()
     * 
     * // Get first 10 WebhookConfigs
     * const webhookConfigs = await prisma.webhookConfig.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const webhookConfigWithIdOnly = await prisma.webhookConfig.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends WebhookConfigFindManyArgs>(args?: SelectSubset<T, WebhookConfigFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$WebhookConfigPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a WebhookConfig.
     * @param {WebhookConfigCreateArgs} args - Arguments to create a WebhookConfig.
     * @example
     * // Create one WebhookConfig
     * const WebhookConfig = await prisma.webhookConfig.create({
     *   data: {
     *     // ... data to create a WebhookConfig
     *   }
     * })
     * 
     */
    create<T extends WebhookConfigCreateArgs>(args: SelectSubset<T, WebhookConfigCreateArgs<ExtArgs>>): Prisma__WebhookConfigClient<$Result.GetResult<Prisma.$WebhookConfigPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many WebhookConfigs.
     * @param {WebhookConfigCreateManyArgs} args - Arguments to create many WebhookConfigs.
     * @example
     * // Create many WebhookConfigs
     * const webhookConfig = await prisma.webhookConfig.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends WebhookConfigCreateManyArgs>(args?: SelectSubset<T, WebhookConfigCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many WebhookConfigs and returns the data saved in the database.
     * @param {WebhookConfigCreateManyAndReturnArgs} args - Arguments to create many WebhookConfigs.
     * @example
     * // Create many WebhookConfigs
     * const webhookConfig = await prisma.webhookConfig.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many WebhookConfigs and only return the `id`
     * const webhookConfigWithIdOnly = await prisma.webhookConfig.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends WebhookConfigCreateManyAndReturnArgs>(args?: SelectSubset<T, WebhookConfigCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$WebhookConfigPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a WebhookConfig.
     * @param {WebhookConfigDeleteArgs} args - Arguments to delete one WebhookConfig.
     * @example
     * // Delete one WebhookConfig
     * const WebhookConfig = await prisma.webhookConfig.delete({
     *   where: {
     *     // ... filter to delete one WebhookConfig
     *   }
     * })
     * 
     */
    delete<T extends WebhookConfigDeleteArgs>(args: SelectSubset<T, WebhookConfigDeleteArgs<ExtArgs>>): Prisma__WebhookConfigClient<$Result.GetResult<Prisma.$WebhookConfigPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one WebhookConfig.
     * @param {WebhookConfigUpdateArgs} args - Arguments to update one WebhookConfig.
     * @example
     * // Update one WebhookConfig
     * const webhookConfig = await prisma.webhookConfig.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends WebhookConfigUpdateArgs>(args: SelectSubset<T, WebhookConfigUpdateArgs<ExtArgs>>): Prisma__WebhookConfigClient<$Result.GetResult<Prisma.$WebhookConfigPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more WebhookConfigs.
     * @param {WebhookConfigDeleteManyArgs} args - Arguments to filter WebhookConfigs to delete.
     * @example
     * // Delete a few WebhookConfigs
     * const { count } = await prisma.webhookConfig.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends WebhookConfigDeleteManyArgs>(args?: SelectSubset<T, WebhookConfigDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more WebhookConfigs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WebhookConfigUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many WebhookConfigs
     * const webhookConfig = await prisma.webhookConfig.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends WebhookConfigUpdateManyArgs>(args: SelectSubset<T, WebhookConfigUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one WebhookConfig.
     * @param {WebhookConfigUpsertArgs} args - Arguments to update or create a WebhookConfig.
     * @example
     * // Update or create a WebhookConfig
     * const webhookConfig = await prisma.webhookConfig.upsert({
     *   create: {
     *     // ... data to create a WebhookConfig
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the WebhookConfig we want to update
     *   }
     * })
     */
    upsert<T extends WebhookConfigUpsertArgs>(args: SelectSubset<T, WebhookConfigUpsertArgs<ExtArgs>>): Prisma__WebhookConfigClient<$Result.GetResult<Prisma.$WebhookConfigPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of WebhookConfigs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WebhookConfigCountArgs} args - Arguments to filter WebhookConfigs to count.
     * @example
     * // Count the number of WebhookConfigs
     * const count = await prisma.webhookConfig.count({
     *   where: {
     *     // ... the filter for the WebhookConfigs we want to count
     *   }
     * })
    **/
    count<T extends WebhookConfigCountArgs>(
      args?: Subset<T, WebhookConfigCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], WebhookConfigCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a WebhookConfig.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WebhookConfigAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends WebhookConfigAggregateArgs>(args: Subset<T, WebhookConfigAggregateArgs>): Prisma.PrismaPromise<GetWebhookConfigAggregateType<T>>

    /**
     * Group by WebhookConfig.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WebhookConfigGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends WebhookConfigGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: WebhookConfigGroupByArgs['orderBy'] }
        : { orderBy?: WebhookConfigGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, WebhookConfigGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetWebhookConfigGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the WebhookConfig model
   */
  readonly fields: WebhookConfigFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for WebhookConfig.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__WebhookConfigClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the WebhookConfig model
   */ 
  interface WebhookConfigFieldRefs {
    readonly id: FieldRef<"WebhookConfig", 'String'>
    readonly url: FieldRef<"WebhookConfig", 'String'>
    readonly type: FieldRef<"WebhookConfig", 'String'>
    readonly events: FieldRef<"WebhookConfig", 'String'>
    readonly active: FieldRef<"WebhookConfig", 'Boolean'>
    readonly createdAt: FieldRef<"WebhookConfig", 'DateTime'>
    readonly updatedAt: FieldRef<"WebhookConfig", 'DateTime'>
    readonly payloadTemplate: FieldRef<"WebhookConfig", 'String'>
  }
    

  // Custom InputTypes
  /**
   * WebhookConfig findUnique
   */
  export type WebhookConfigFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WebhookConfig
     */
    select?: WebhookConfigSelect<ExtArgs> | null
    /**
     * Filter, which WebhookConfig to fetch.
     */
    where: WebhookConfigWhereUniqueInput
  }

  /**
   * WebhookConfig findUniqueOrThrow
   */
  export type WebhookConfigFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WebhookConfig
     */
    select?: WebhookConfigSelect<ExtArgs> | null
    /**
     * Filter, which WebhookConfig to fetch.
     */
    where: WebhookConfigWhereUniqueInput
  }

  /**
   * WebhookConfig findFirst
   */
  export type WebhookConfigFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WebhookConfig
     */
    select?: WebhookConfigSelect<ExtArgs> | null
    /**
     * Filter, which WebhookConfig to fetch.
     */
    where?: WebhookConfigWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WebhookConfigs to fetch.
     */
    orderBy?: WebhookConfigOrderByWithRelationInput | WebhookConfigOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for WebhookConfigs.
     */
    cursor?: WebhookConfigWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WebhookConfigs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WebhookConfigs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of WebhookConfigs.
     */
    distinct?: WebhookConfigScalarFieldEnum | WebhookConfigScalarFieldEnum[]
  }

  /**
   * WebhookConfig findFirstOrThrow
   */
  export type WebhookConfigFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WebhookConfig
     */
    select?: WebhookConfigSelect<ExtArgs> | null
    /**
     * Filter, which WebhookConfig to fetch.
     */
    where?: WebhookConfigWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WebhookConfigs to fetch.
     */
    orderBy?: WebhookConfigOrderByWithRelationInput | WebhookConfigOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for WebhookConfigs.
     */
    cursor?: WebhookConfigWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WebhookConfigs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WebhookConfigs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of WebhookConfigs.
     */
    distinct?: WebhookConfigScalarFieldEnum | WebhookConfigScalarFieldEnum[]
  }

  /**
   * WebhookConfig findMany
   */
  export type WebhookConfigFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WebhookConfig
     */
    select?: WebhookConfigSelect<ExtArgs> | null
    /**
     * Filter, which WebhookConfigs to fetch.
     */
    where?: WebhookConfigWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WebhookConfigs to fetch.
     */
    orderBy?: WebhookConfigOrderByWithRelationInput | WebhookConfigOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing WebhookConfigs.
     */
    cursor?: WebhookConfigWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WebhookConfigs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WebhookConfigs.
     */
    skip?: number
    distinct?: WebhookConfigScalarFieldEnum | WebhookConfigScalarFieldEnum[]
  }

  /**
   * WebhookConfig create
   */
  export type WebhookConfigCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WebhookConfig
     */
    select?: WebhookConfigSelect<ExtArgs> | null
    /**
     * The data needed to create a WebhookConfig.
     */
    data: XOR<WebhookConfigCreateInput, WebhookConfigUncheckedCreateInput>
  }

  /**
   * WebhookConfig createMany
   */
  export type WebhookConfigCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many WebhookConfigs.
     */
    data: WebhookConfigCreateManyInput | WebhookConfigCreateManyInput[]
  }

  /**
   * WebhookConfig createManyAndReturn
   */
  export type WebhookConfigCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WebhookConfig
     */
    select?: WebhookConfigSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many WebhookConfigs.
     */
    data: WebhookConfigCreateManyInput | WebhookConfigCreateManyInput[]
  }

  /**
   * WebhookConfig update
   */
  export type WebhookConfigUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WebhookConfig
     */
    select?: WebhookConfigSelect<ExtArgs> | null
    /**
     * The data needed to update a WebhookConfig.
     */
    data: XOR<WebhookConfigUpdateInput, WebhookConfigUncheckedUpdateInput>
    /**
     * Choose, which WebhookConfig to update.
     */
    where: WebhookConfigWhereUniqueInput
  }

  /**
   * WebhookConfig updateMany
   */
  export type WebhookConfigUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update WebhookConfigs.
     */
    data: XOR<WebhookConfigUpdateManyMutationInput, WebhookConfigUncheckedUpdateManyInput>
    /**
     * Filter which WebhookConfigs to update
     */
    where?: WebhookConfigWhereInput
  }

  /**
   * WebhookConfig upsert
   */
  export type WebhookConfigUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WebhookConfig
     */
    select?: WebhookConfigSelect<ExtArgs> | null
    /**
     * The filter to search for the WebhookConfig to update in case it exists.
     */
    where: WebhookConfigWhereUniqueInput
    /**
     * In case the WebhookConfig found by the `where` argument doesn't exist, create a new WebhookConfig with this data.
     */
    create: XOR<WebhookConfigCreateInput, WebhookConfigUncheckedCreateInput>
    /**
     * In case the WebhookConfig was found with the provided `where` argument, update it with this data.
     */
    update: XOR<WebhookConfigUpdateInput, WebhookConfigUncheckedUpdateInput>
  }

  /**
   * WebhookConfig delete
   */
  export type WebhookConfigDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WebhookConfig
     */
    select?: WebhookConfigSelect<ExtArgs> | null
    /**
     * Filter which WebhookConfig to delete.
     */
    where: WebhookConfigWhereUniqueInput
  }

  /**
   * WebhookConfig deleteMany
   */
  export type WebhookConfigDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which WebhookConfigs to delete
     */
    where?: WebhookConfigWhereInput
  }

  /**
   * WebhookConfig without action
   */
  export type WebhookConfigDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WebhookConfig
     */
    select?: WebhookConfigSelect<ExtArgs> | null
  }


  /**
   * Model WebConfig
   */

  export type AggregateWebConfig = {
    _count: WebConfigCountAggregateOutputType | null
    _min: WebConfigMinAggregateOutputType | null
    _max: WebConfigMaxAggregateOutputType | null
  }

  export type WebConfigMinAggregateOutputType = {
    id: string | null
    name: string | null
    value: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type WebConfigMaxAggregateOutputType = {
    id: string | null
    name: string | null
    value: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type WebConfigCountAggregateOutputType = {
    id: number
    name: number
    value: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type WebConfigMinAggregateInputType = {
    id?: true
    name?: true
    value?: true
    createdAt?: true
    updatedAt?: true
  }

  export type WebConfigMaxAggregateInputType = {
    id?: true
    name?: true
    value?: true
    createdAt?: true
    updatedAt?: true
  }

  export type WebConfigCountAggregateInputType = {
    id?: true
    name?: true
    value?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type WebConfigAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which WebConfig to aggregate.
     */
    where?: WebConfigWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WebConfigs to fetch.
     */
    orderBy?: WebConfigOrderByWithRelationInput | WebConfigOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: WebConfigWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WebConfigs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WebConfigs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned WebConfigs
    **/
    _count?: true | WebConfigCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: WebConfigMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: WebConfigMaxAggregateInputType
  }

  export type GetWebConfigAggregateType<T extends WebConfigAggregateArgs> = {
        [P in keyof T & keyof AggregateWebConfig]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateWebConfig[P]>
      : GetScalarType<T[P], AggregateWebConfig[P]>
  }




  export type WebConfigGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: WebConfigWhereInput
    orderBy?: WebConfigOrderByWithAggregationInput | WebConfigOrderByWithAggregationInput[]
    by: WebConfigScalarFieldEnum[] | WebConfigScalarFieldEnum
    having?: WebConfigScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: WebConfigCountAggregateInputType | true
    _min?: WebConfigMinAggregateInputType
    _max?: WebConfigMaxAggregateInputType
  }

  export type WebConfigGroupByOutputType = {
    id: string
    name: string
    value: string
    createdAt: Date
    updatedAt: Date
    _count: WebConfigCountAggregateOutputType | null
    _min: WebConfigMinAggregateOutputType | null
    _max: WebConfigMaxAggregateOutputType | null
  }

  type GetWebConfigGroupByPayload<T extends WebConfigGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<WebConfigGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof WebConfigGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], WebConfigGroupByOutputType[P]>
            : GetScalarType<T[P], WebConfigGroupByOutputType[P]>
        }
      >
    >


  export type WebConfigSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    value?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["webConfig"]>

  export type WebConfigSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    value?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["webConfig"]>

  export type WebConfigSelectScalar = {
    id?: boolean
    name?: boolean
    value?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }


  export type $WebConfigPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "WebConfig"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      name: string
      value: string
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["webConfig"]>
    composites: {}
  }

  type WebConfigGetPayload<S extends boolean | null | undefined | WebConfigDefaultArgs> = $Result.GetResult<Prisma.$WebConfigPayload, S>

  type WebConfigCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<WebConfigFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: WebConfigCountAggregateInputType | true
    }

  export interface WebConfigDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['WebConfig'], meta: { name: 'WebConfig' } }
    /**
     * Find zero or one WebConfig that matches the filter.
     * @param {WebConfigFindUniqueArgs} args - Arguments to find a WebConfig
     * @example
     * // Get one WebConfig
     * const webConfig = await prisma.webConfig.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends WebConfigFindUniqueArgs>(args: SelectSubset<T, WebConfigFindUniqueArgs<ExtArgs>>): Prisma__WebConfigClient<$Result.GetResult<Prisma.$WebConfigPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one WebConfig that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {WebConfigFindUniqueOrThrowArgs} args - Arguments to find a WebConfig
     * @example
     * // Get one WebConfig
     * const webConfig = await prisma.webConfig.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends WebConfigFindUniqueOrThrowArgs>(args: SelectSubset<T, WebConfigFindUniqueOrThrowArgs<ExtArgs>>): Prisma__WebConfigClient<$Result.GetResult<Prisma.$WebConfigPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first WebConfig that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WebConfigFindFirstArgs} args - Arguments to find a WebConfig
     * @example
     * // Get one WebConfig
     * const webConfig = await prisma.webConfig.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends WebConfigFindFirstArgs>(args?: SelectSubset<T, WebConfigFindFirstArgs<ExtArgs>>): Prisma__WebConfigClient<$Result.GetResult<Prisma.$WebConfigPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first WebConfig that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WebConfigFindFirstOrThrowArgs} args - Arguments to find a WebConfig
     * @example
     * // Get one WebConfig
     * const webConfig = await prisma.webConfig.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends WebConfigFindFirstOrThrowArgs>(args?: SelectSubset<T, WebConfigFindFirstOrThrowArgs<ExtArgs>>): Prisma__WebConfigClient<$Result.GetResult<Prisma.$WebConfigPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more WebConfigs that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WebConfigFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all WebConfigs
     * const webConfigs = await prisma.webConfig.findMany()
     * 
     * // Get first 10 WebConfigs
     * const webConfigs = await prisma.webConfig.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const webConfigWithIdOnly = await prisma.webConfig.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends WebConfigFindManyArgs>(args?: SelectSubset<T, WebConfigFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$WebConfigPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a WebConfig.
     * @param {WebConfigCreateArgs} args - Arguments to create a WebConfig.
     * @example
     * // Create one WebConfig
     * const WebConfig = await prisma.webConfig.create({
     *   data: {
     *     // ... data to create a WebConfig
     *   }
     * })
     * 
     */
    create<T extends WebConfigCreateArgs>(args: SelectSubset<T, WebConfigCreateArgs<ExtArgs>>): Prisma__WebConfigClient<$Result.GetResult<Prisma.$WebConfigPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many WebConfigs.
     * @param {WebConfigCreateManyArgs} args - Arguments to create many WebConfigs.
     * @example
     * // Create many WebConfigs
     * const webConfig = await prisma.webConfig.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends WebConfigCreateManyArgs>(args?: SelectSubset<T, WebConfigCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many WebConfigs and returns the data saved in the database.
     * @param {WebConfigCreateManyAndReturnArgs} args - Arguments to create many WebConfigs.
     * @example
     * // Create many WebConfigs
     * const webConfig = await prisma.webConfig.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many WebConfigs and only return the `id`
     * const webConfigWithIdOnly = await prisma.webConfig.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends WebConfigCreateManyAndReturnArgs>(args?: SelectSubset<T, WebConfigCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$WebConfigPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a WebConfig.
     * @param {WebConfigDeleteArgs} args - Arguments to delete one WebConfig.
     * @example
     * // Delete one WebConfig
     * const WebConfig = await prisma.webConfig.delete({
     *   where: {
     *     // ... filter to delete one WebConfig
     *   }
     * })
     * 
     */
    delete<T extends WebConfigDeleteArgs>(args: SelectSubset<T, WebConfigDeleteArgs<ExtArgs>>): Prisma__WebConfigClient<$Result.GetResult<Prisma.$WebConfigPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one WebConfig.
     * @param {WebConfigUpdateArgs} args - Arguments to update one WebConfig.
     * @example
     * // Update one WebConfig
     * const webConfig = await prisma.webConfig.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends WebConfigUpdateArgs>(args: SelectSubset<T, WebConfigUpdateArgs<ExtArgs>>): Prisma__WebConfigClient<$Result.GetResult<Prisma.$WebConfigPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more WebConfigs.
     * @param {WebConfigDeleteManyArgs} args - Arguments to filter WebConfigs to delete.
     * @example
     * // Delete a few WebConfigs
     * const { count } = await prisma.webConfig.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends WebConfigDeleteManyArgs>(args?: SelectSubset<T, WebConfigDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more WebConfigs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WebConfigUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many WebConfigs
     * const webConfig = await prisma.webConfig.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends WebConfigUpdateManyArgs>(args: SelectSubset<T, WebConfigUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one WebConfig.
     * @param {WebConfigUpsertArgs} args - Arguments to update or create a WebConfig.
     * @example
     * // Update or create a WebConfig
     * const webConfig = await prisma.webConfig.upsert({
     *   create: {
     *     // ... data to create a WebConfig
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the WebConfig we want to update
     *   }
     * })
     */
    upsert<T extends WebConfigUpsertArgs>(args: SelectSubset<T, WebConfigUpsertArgs<ExtArgs>>): Prisma__WebConfigClient<$Result.GetResult<Prisma.$WebConfigPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of WebConfigs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WebConfigCountArgs} args - Arguments to filter WebConfigs to count.
     * @example
     * // Count the number of WebConfigs
     * const count = await prisma.webConfig.count({
     *   where: {
     *     // ... the filter for the WebConfigs we want to count
     *   }
     * })
    **/
    count<T extends WebConfigCountArgs>(
      args?: Subset<T, WebConfigCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], WebConfigCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a WebConfig.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WebConfigAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends WebConfigAggregateArgs>(args: Subset<T, WebConfigAggregateArgs>): Prisma.PrismaPromise<GetWebConfigAggregateType<T>>

    /**
     * Group by WebConfig.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {WebConfigGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends WebConfigGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: WebConfigGroupByArgs['orderBy'] }
        : { orderBy?: WebConfigGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, WebConfigGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetWebConfigGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the WebConfig model
   */
  readonly fields: WebConfigFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for WebConfig.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__WebConfigClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the WebConfig model
   */ 
  interface WebConfigFieldRefs {
    readonly id: FieldRef<"WebConfig", 'String'>
    readonly name: FieldRef<"WebConfig", 'String'>
    readonly value: FieldRef<"WebConfig", 'String'>
    readonly createdAt: FieldRef<"WebConfig", 'DateTime'>
    readonly updatedAt: FieldRef<"WebConfig", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * WebConfig findUnique
   */
  export type WebConfigFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WebConfig
     */
    select?: WebConfigSelect<ExtArgs> | null
    /**
     * Filter, which WebConfig to fetch.
     */
    where: WebConfigWhereUniqueInput
  }

  /**
   * WebConfig findUniqueOrThrow
   */
  export type WebConfigFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WebConfig
     */
    select?: WebConfigSelect<ExtArgs> | null
    /**
     * Filter, which WebConfig to fetch.
     */
    where: WebConfigWhereUniqueInput
  }

  /**
   * WebConfig findFirst
   */
  export type WebConfigFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WebConfig
     */
    select?: WebConfigSelect<ExtArgs> | null
    /**
     * Filter, which WebConfig to fetch.
     */
    where?: WebConfigWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WebConfigs to fetch.
     */
    orderBy?: WebConfigOrderByWithRelationInput | WebConfigOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for WebConfigs.
     */
    cursor?: WebConfigWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WebConfigs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WebConfigs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of WebConfigs.
     */
    distinct?: WebConfigScalarFieldEnum | WebConfigScalarFieldEnum[]
  }

  /**
   * WebConfig findFirstOrThrow
   */
  export type WebConfigFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WebConfig
     */
    select?: WebConfigSelect<ExtArgs> | null
    /**
     * Filter, which WebConfig to fetch.
     */
    where?: WebConfigWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WebConfigs to fetch.
     */
    orderBy?: WebConfigOrderByWithRelationInput | WebConfigOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for WebConfigs.
     */
    cursor?: WebConfigWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WebConfigs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WebConfigs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of WebConfigs.
     */
    distinct?: WebConfigScalarFieldEnum | WebConfigScalarFieldEnum[]
  }

  /**
   * WebConfig findMany
   */
  export type WebConfigFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WebConfig
     */
    select?: WebConfigSelect<ExtArgs> | null
    /**
     * Filter, which WebConfigs to fetch.
     */
    where?: WebConfigWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of WebConfigs to fetch.
     */
    orderBy?: WebConfigOrderByWithRelationInput | WebConfigOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing WebConfigs.
     */
    cursor?: WebConfigWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` WebConfigs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` WebConfigs.
     */
    skip?: number
    distinct?: WebConfigScalarFieldEnum | WebConfigScalarFieldEnum[]
  }

  /**
   * WebConfig create
   */
  export type WebConfigCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WebConfig
     */
    select?: WebConfigSelect<ExtArgs> | null
    /**
     * The data needed to create a WebConfig.
     */
    data: XOR<WebConfigCreateInput, WebConfigUncheckedCreateInput>
  }

  /**
   * WebConfig createMany
   */
  export type WebConfigCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many WebConfigs.
     */
    data: WebConfigCreateManyInput | WebConfigCreateManyInput[]
  }

  /**
   * WebConfig createManyAndReturn
   */
  export type WebConfigCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WebConfig
     */
    select?: WebConfigSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many WebConfigs.
     */
    data: WebConfigCreateManyInput | WebConfigCreateManyInput[]
  }

  /**
   * WebConfig update
   */
  export type WebConfigUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WebConfig
     */
    select?: WebConfigSelect<ExtArgs> | null
    /**
     * The data needed to update a WebConfig.
     */
    data: XOR<WebConfigUpdateInput, WebConfigUncheckedUpdateInput>
    /**
     * Choose, which WebConfig to update.
     */
    where: WebConfigWhereUniqueInput
  }

  /**
   * WebConfig updateMany
   */
  export type WebConfigUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update WebConfigs.
     */
    data: XOR<WebConfigUpdateManyMutationInput, WebConfigUncheckedUpdateManyInput>
    /**
     * Filter which WebConfigs to update
     */
    where?: WebConfigWhereInput
  }

  /**
   * WebConfig upsert
   */
  export type WebConfigUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WebConfig
     */
    select?: WebConfigSelect<ExtArgs> | null
    /**
     * The filter to search for the WebConfig to update in case it exists.
     */
    where: WebConfigWhereUniqueInput
    /**
     * In case the WebConfig found by the `where` argument doesn't exist, create a new WebConfig with this data.
     */
    create: XOR<WebConfigCreateInput, WebConfigUncheckedCreateInput>
    /**
     * In case the WebConfig was found with the provided `where` argument, update it with this data.
     */
    update: XOR<WebConfigUpdateInput, WebConfigUncheckedUpdateInput>
  }

  /**
   * WebConfig delete
   */
  export type WebConfigDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WebConfig
     */
    select?: WebConfigSelect<ExtArgs> | null
    /**
     * Filter which WebConfig to delete.
     */
    where: WebConfigWhereUniqueInput
  }

  /**
   * WebConfig deleteMany
   */
  export type WebConfigDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which WebConfigs to delete
     */
    where?: WebConfigWhereInput
  }

  /**
   * WebConfig without action
   */
  export type WebConfigDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the WebConfig
     */
    select?: WebConfigSelect<ExtArgs> | null
  }


  /**
   * Model LocatorEtalon
   */

  export type AggregateLocatorEtalon = {
    _count: LocatorEtalonCountAggregateOutputType | null
    _min: LocatorEtalonMinAggregateOutputType | null
    _max: LocatorEtalonMaxAggregateOutputType | null
  }

  export type LocatorEtalonMinAggregateOutputType = {
    id: string | null
    selector: string | null
    strategy: string | null
    attributes: string | null
    nodeName: string | null
    lastSeen: Date | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type LocatorEtalonMaxAggregateOutputType = {
    id: string | null
    selector: string | null
    strategy: string | null
    attributes: string | null
    nodeName: string | null
    lastSeen: Date | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type LocatorEtalonCountAggregateOutputType = {
    id: number
    selector: number
    strategy: number
    attributes: number
    nodeName: number
    lastSeen: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type LocatorEtalonMinAggregateInputType = {
    id?: true
    selector?: true
    strategy?: true
    attributes?: true
    nodeName?: true
    lastSeen?: true
    createdAt?: true
    updatedAt?: true
  }

  export type LocatorEtalonMaxAggregateInputType = {
    id?: true
    selector?: true
    strategy?: true
    attributes?: true
    nodeName?: true
    lastSeen?: true
    createdAt?: true
    updatedAt?: true
  }

  export type LocatorEtalonCountAggregateInputType = {
    id?: true
    selector?: true
    strategy?: true
    attributes?: true
    nodeName?: true
    lastSeen?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type LocatorEtalonAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which LocatorEtalon to aggregate.
     */
    where?: LocatorEtalonWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of LocatorEtalons to fetch.
     */
    orderBy?: LocatorEtalonOrderByWithRelationInput | LocatorEtalonOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: LocatorEtalonWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` LocatorEtalons from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` LocatorEtalons.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned LocatorEtalons
    **/
    _count?: true | LocatorEtalonCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: LocatorEtalonMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: LocatorEtalonMaxAggregateInputType
  }

  export type GetLocatorEtalonAggregateType<T extends LocatorEtalonAggregateArgs> = {
        [P in keyof T & keyof AggregateLocatorEtalon]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateLocatorEtalon[P]>
      : GetScalarType<T[P], AggregateLocatorEtalon[P]>
  }




  export type LocatorEtalonGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: LocatorEtalonWhereInput
    orderBy?: LocatorEtalonOrderByWithAggregationInput | LocatorEtalonOrderByWithAggregationInput[]
    by: LocatorEtalonScalarFieldEnum[] | LocatorEtalonScalarFieldEnum
    having?: LocatorEtalonScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: LocatorEtalonCountAggregateInputType | true
    _min?: LocatorEtalonMinAggregateInputType
    _max?: LocatorEtalonMaxAggregateInputType
  }

  export type LocatorEtalonGroupByOutputType = {
    id: string
    selector: string
    strategy: string
    attributes: string
    nodeName: string
    lastSeen: Date
    createdAt: Date
    updatedAt: Date
    _count: LocatorEtalonCountAggregateOutputType | null
    _min: LocatorEtalonMinAggregateOutputType | null
    _max: LocatorEtalonMaxAggregateOutputType | null
  }

  type GetLocatorEtalonGroupByPayload<T extends LocatorEtalonGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<LocatorEtalonGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof LocatorEtalonGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], LocatorEtalonGroupByOutputType[P]>
            : GetScalarType<T[P], LocatorEtalonGroupByOutputType[P]>
        }
      >
    >


  export type LocatorEtalonSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    selector?: boolean
    strategy?: boolean
    attributes?: boolean
    nodeName?: boolean
    lastSeen?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["locatorEtalon"]>

  export type LocatorEtalonSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    selector?: boolean
    strategy?: boolean
    attributes?: boolean
    nodeName?: boolean
    lastSeen?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["locatorEtalon"]>

  export type LocatorEtalonSelectScalar = {
    id?: boolean
    selector?: boolean
    strategy?: boolean
    attributes?: boolean
    nodeName?: boolean
    lastSeen?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }


  export type $LocatorEtalonPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "LocatorEtalon"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      selector: string
      strategy: string
      attributes: string
      nodeName: string
      lastSeen: Date
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["locatorEtalon"]>
    composites: {}
  }

  type LocatorEtalonGetPayload<S extends boolean | null | undefined | LocatorEtalonDefaultArgs> = $Result.GetResult<Prisma.$LocatorEtalonPayload, S>

  type LocatorEtalonCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<LocatorEtalonFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: LocatorEtalonCountAggregateInputType | true
    }

  export interface LocatorEtalonDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['LocatorEtalon'], meta: { name: 'LocatorEtalon' } }
    /**
     * Find zero or one LocatorEtalon that matches the filter.
     * @param {LocatorEtalonFindUniqueArgs} args - Arguments to find a LocatorEtalon
     * @example
     * // Get one LocatorEtalon
     * const locatorEtalon = await prisma.locatorEtalon.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends LocatorEtalonFindUniqueArgs>(args: SelectSubset<T, LocatorEtalonFindUniqueArgs<ExtArgs>>): Prisma__LocatorEtalonClient<$Result.GetResult<Prisma.$LocatorEtalonPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one LocatorEtalon that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {LocatorEtalonFindUniqueOrThrowArgs} args - Arguments to find a LocatorEtalon
     * @example
     * // Get one LocatorEtalon
     * const locatorEtalon = await prisma.locatorEtalon.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends LocatorEtalonFindUniqueOrThrowArgs>(args: SelectSubset<T, LocatorEtalonFindUniqueOrThrowArgs<ExtArgs>>): Prisma__LocatorEtalonClient<$Result.GetResult<Prisma.$LocatorEtalonPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first LocatorEtalon that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {LocatorEtalonFindFirstArgs} args - Arguments to find a LocatorEtalon
     * @example
     * // Get one LocatorEtalon
     * const locatorEtalon = await prisma.locatorEtalon.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends LocatorEtalonFindFirstArgs>(args?: SelectSubset<T, LocatorEtalonFindFirstArgs<ExtArgs>>): Prisma__LocatorEtalonClient<$Result.GetResult<Prisma.$LocatorEtalonPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first LocatorEtalon that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {LocatorEtalonFindFirstOrThrowArgs} args - Arguments to find a LocatorEtalon
     * @example
     * // Get one LocatorEtalon
     * const locatorEtalon = await prisma.locatorEtalon.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends LocatorEtalonFindFirstOrThrowArgs>(args?: SelectSubset<T, LocatorEtalonFindFirstOrThrowArgs<ExtArgs>>): Prisma__LocatorEtalonClient<$Result.GetResult<Prisma.$LocatorEtalonPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more LocatorEtalons that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {LocatorEtalonFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all LocatorEtalons
     * const locatorEtalons = await prisma.locatorEtalon.findMany()
     * 
     * // Get first 10 LocatorEtalons
     * const locatorEtalons = await prisma.locatorEtalon.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const locatorEtalonWithIdOnly = await prisma.locatorEtalon.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends LocatorEtalonFindManyArgs>(args?: SelectSubset<T, LocatorEtalonFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$LocatorEtalonPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a LocatorEtalon.
     * @param {LocatorEtalonCreateArgs} args - Arguments to create a LocatorEtalon.
     * @example
     * // Create one LocatorEtalon
     * const LocatorEtalon = await prisma.locatorEtalon.create({
     *   data: {
     *     // ... data to create a LocatorEtalon
     *   }
     * })
     * 
     */
    create<T extends LocatorEtalonCreateArgs>(args: SelectSubset<T, LocatorEtalonCreateArgs<ExtArgs>>): Prisma__LocatorEtalonClient<$Result.GetResult<Prisma.$LocatorEtalonPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many LocatorEtalons.
     * @param {LocatorEtalonCreateManyArgs} args - Arguments to create many LocatorEtalons.
     * @example
     * // Create many LocatorEtalons
     * const locatorEtalon = await prisma.locatorEtalon.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends LocatorEtalonCreateManyArgs>(args?: SelectSubset<T, LocatorEtalonCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many LocatorEtalons and returns the data saved in the database.
     * @param {LocatorEtalonCreateManyAndReturnArgs} args - Arguments to create many LocatorEtalons.
     * @example
     * // Create many LocatorEtalons
     * const locatorEtalon = await prisma.locatorEtalon.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many LocatorEtalons and only return the `id`
     * const locatorEtalonWithIdOnly = await prisma.locatorEtalon.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends LocatorEtalonCreateManyAndReturnArgs>(args?: SelectSubset<T, LocatorEtalonCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$LocatorEtalonPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a LocatorEtalon.
     * @param {LocatorEtalonDeleteArgs} args - Arguments to delete one LocatorEtalon.
     * @example
     * // Delete one LocatorEtalon
     * const LocatorEtalon = await prisma.locatorEtalon.delete({
     *   where: {
     *     // ... filter to delete one LocatorEtalon
     *   }
     * })
     * 
     */
    delete<T extends LocatorEtalonDeleteArgs>(args: SelectSubset<T, LocatorEtalonDeleteArgs<ExtArgs>>): Prisma__LocatorEtalonClient<$Result.GetResult<Prisma.$LocatorEtalonPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one LocatorEtalon.
     * @param {LocatorEtalonUpdateArgs} args - Arguments to update one LocatorEtalon.
     * @example
     * // Update one LocatorEtalon
     * const locatorEtalon = await prisma.locatorEtalon.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends LocatorEtalonUpdateArgs>(args: SelectSubset<T, LocatorEtalonUpdateArgs<ExtArgs>>): Prisma__LocatorEtalonClient<$Result.GetResult<Prisma.$LocatorEtalonPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more LocatorEtalons.
     * @param {LocatorEtalonDeleteManyArgs} args - Arguments to filter LocatorEtalons to delete.
     * @example
     * // Delete a few LocatorEtalons
     * const { count } = await prisma.locatorEtalon.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends LocatorEtalonDeleteManyArgs>(args?: SelectSubset<T, LocatorEtalonDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more LocatorEtalons.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {LocatorEtalonUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many LocatorEtalons
     * const locatorEtalon = await prisma.locatorEtalon.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends LocatorEtalonUpdateManyArgs>(args: SelectSubset<T, LocatorEtalonUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one LocatorEtalon.
     * @param {LocatorEtalonUpsertArgs} args - Arguments to update or create a LocatorEtalon.
     * @example
     * // Update or create a LocatorEtalon
     * const locatorEtalon = await prisma.locatorEtalon.upsert({
     *   create: {
     *     // ... data to create a LocatorEtalon
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the LocatorEtalon we want to update
     *   }
     * })
     */
    upsert<T extends LocatorEtalonUpsertArgs>(args: SelectSubset<T, LocatorEtalonUpsertArgs<ExtArgs>>): Prisma__LocatorEtalonClient<$Result.GetResult<Prisma.$LocatorEtalonPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of LocatorEtalons.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {LocatorEtalonCountArgs} args - Arguments to filter LocatorEtalons to count.
     * @example
     * // Count the number of LocatorEtalons
     * const count = await prisma.locatorEtalon.count({
     *   where: {
     *     // ... the filter for the LocatorEtalons we want to count
     *   }
     * })
    **/
    count<T extends LocatorEtalonCountArgs>(
      args?: Subset<T, LocatorEtalonCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], LocatorEtalonCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a LocatorEtalon.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {LocatorEtalonAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends LocatorEtalonAggregateArgs>(args: Subset<T, LocatorEtalonAggregateArgs>): Prisma.PrismaPromise<GetLocatorEtalonAggregateType<T>>

    /**
     * Group by LocatorEtalon.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {LocatorEtalonGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends LocatorEtalonGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: LocatorEtalonGroupByArgs['orderBy'] }
        : { orderBy?: LocatorEtalonGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, LocatorEtalonGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetLocatorEtalonGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the LocatorEtalon model
   */
  readonly fields: LocatorEtalonFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for LocatorEtalon.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__LocatorEtalonClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the LocatorEtalon model
   */ 
  interface LocatorEtalonFieldRefs {
    readonly id: FieldRef<"LocatorEtalon", 'String'>
    readonly selector: FieldRef<"LocatorEtalon", 'String'>
    readonly strategy: FieldRef<"LocatorEtalon", 'String'>
    readonly attributes: FieldRef<"LocatorEtalon", 'String'>
    readonly nodeName: FieldRef<"LocatorEtalon", 'String'>
    readonly lastSeen: FieldRef<"LocatorEtalon", 'DateTime'>
    readonly createdAt: FieldRef<"LocatorEtalon", 'DateTime'>
    readonly updatedAt: FieldRef<"LocatorEtalon", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * LocatorEtalon findUnique
   */
  export type LocatorEtalonFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the LocatorEtalon
     */
    select?: LocatorEtalonSelect<ExtArgs> | null
    /**
     * Filter, which LocatorEtalon to fetch.
     */
    where: LocatorEtalonWhereUniqueInput
  }

  /**
   * LocatorEtalon findUniqueOrThrow
   */
  export type LocatorEtalonFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the LocatorEtalon
     */
    select?: LocatorEtalonSelect<ExtArgs> | null
    /**
     * Filter, which LocatorEtalon to fetch.
     */
    where: LocatorEtalonWhereUniqueInput
  }

  /**
   * LocatorEtalon findFirst
   */
  export type LocatorEtalonFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the LocatorEtalon
     */
    select?: LocatorEtalonSelect<ExtArgs> | null
    /**
     * Filter, which LocatorEtalon to fetch.
     */
    where?: LocatorEtalonWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of LocatorEtalons to fetch.
     */
    orderBy?: LocatorEtalonOrderByWithRelationInput | LocatorEtalonOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for LocatorEtalons.
     */
    cursor?: LocatorEtalonWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` LocatorEtalons from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` LocatorEtalons.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of LocatorEtalons.
     */
    distinct?: LocatorEtalonScalarFieldEnum | LocatorEtalonScalarFieldEnum[]
  }

  /**
   * LocatorEtalon findFirstOrThrow
   */
  export type LocatorEtalonFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the LocatorEtalon
     */
    select?: LocatorEtalonSelect<ExtArgs> | null
    /**
     * Filter, which LocatorEtalon to fetch.
     */
    where?: LocatorEtalonWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of LocatorEtalons to fetch.
     */
    orderBy?: LocatorEtalonOrderByWithRelationInput | LocatorEtalonOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for LocatorEtalons.
     */
    cursor?: LocatorEtalonWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` LocatorEtalons from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` LocatorEtalons.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of LocatorEtalons.
     */
    distinct?: LocatorEtalonScalarFieldEnum | LocatorEtalonScalarFieldEnum[]
  }

  /**
   * LocatorEtalon findMany
   */
  export type LocatorEtalonFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the LocatorEtalon
     */
    select?: LocatorEtalonSelect<ExtArgs> | null
    /**
     * Filter, which LocatorEtalons to fetch.
     */
    where?: LocatorEtalonWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of LocatorEtalons to fetch.
     */
    orderBy?: LocatorEtalonOrderByWithRelationInput | LocatorEtalonOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing LocatorEtalons.
     */
    cursor?: LocatorEtalonWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` LocatorEtalons from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` LocatorEtalons.
     */
    skip?: number
    distinct?: LocatorEtalonScalarFieldEnum | LocatorEtalonScalarFieldEnum[]
  }

  /**
   * LocatorEtalon create
   */
  export type LocatorEtalonCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the LocatorEtalon
     */
    select?: LocatorEtalonSelect<ExtArgs> | null
    /**
     * The data needed to create a LocatorEtalon.
     */
    data: XOR<LocatorEtalonCreateInput, LocatorEtalonUncheckedCreateInput>
  }

  /**
   * LocatorEtalon createMany
   */
  export type LocatorEtalonCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many LocatorEtalons.
     */
    data: LocatorEtalonCreateManyInput | LocatorEtalonCreateManyInput[]
  }

  /**
   * LocatorEtalon createManyAndReturn
   */
  export type LocatorEtalonCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the LocatorEtalon
     */
    select?: LocatorEtalonSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many LocatorEtalons.
     */
    data: LocatorEtalonCreateManyInput | LocatorEtalonCreateManyInput[]
  }

  /**
   * LocatorEtalon update
   */
  export type LocatorEtalonUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the LocatorEtalon
     */
    select?: LocatorEtalonSelect<ExtArgs> | null
    /**
     * The data needed to update a LocatorEtalon.
     */
    data: XOR<LocatorEtalonUpdateInput, LocatorEtalonUncheckedUpdateInput>
    /**
     * Choose, which LocatorEtalon to update.
     */
    where: LocatorEtalonWhereUniqueInput
  }

  /**
   * LocatorEtalon updateMany
   */
  export type LocatorEtalonUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update LocatorEtalons.
     */
    data: XOR<LocatorEtalonUpdateManyMutationInput, LocatorEtalonUncheckedUpdateManyInput>
    /**
     * Filter which LocatorEtalons to update
     */
    where?: LocatorEtalonWhereInput
  }

  /**
   * LocatorEtalon upsert
   */
  export type LocatorEtalonUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the LocatorEtalon
     */
    select?: LocatorEtalonSelect<ExtArgs> | null
    /**
     * The filter to search for the LocatorEtalon to update in case it exists.
     */
    where: LocatorEtalonWhereUniqueInput
    /**
     * In case the LocatorEtalon found by the `where` argument doesn't exist, create a new LocatorEtalon with this data.
     */
    create: XOR<LocatorEtalonCreateInput, LocatorEtalonUncheckedCreateInput>
    /**
     * In case the LocatorEtalon was found with the provided `where` argument, update it with this data.
     */
    update: XOR<LocatorEtalonUpdateInput, LocatorEtalonUncheckedUpdateInput>
  }

  /**
   * LocatorEtalon delete
   */
  export type LocatorEtalonDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the LocatorEtalon
     */
    select?: LocatorEtalonSelect<ExtArgs> | null
    /**
     * Filter which LocatorEtalon to delete.
     */
    where: LocatorEtalonWhereUniqueInput
  }

  /**
   * LocatorEtalon deleteMany
   */
  export type LocatorEtalonDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which LocatorEtalons to delete
     */
    where?: LocatorEtalonWhereInput
  }

  /**
   * LocatorEtalon without action
   */
  export type LocatorEtalonDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the LocatorEtalon
     */
    select?: LocatorEtalonSelect<ExtArgs> | null
  }


  /**
   * Enums
   */

  export const TransactionIsolationLevel: {
    Serializable: 'Serializable'
  };

  export type TransactionIsolationLevel = (typeof TransactionIsolationLevel)[keyof typeof TransactionIsolationLevel]


  export const BuildScalarFieldEnum: {
    id: 'id',
    name: 'name',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type BuildScalarFieldEnum = (typeof BuildScalarFieldEnum)[keyof typeof BuildScalarFieldEnum]


  export const SessionScalarFieldEnum: {
    id: 'id',
    build_id: 'build_id',
    name: 'name',
    status: 'status',
    desired_capabilities: 'desired_capabilities',
    session_capabilities: 'session_capabilities',
    node_id: 'node_id',
    has_live_video: 'has_live_video',
    video_recording_enabled: 'video_recording_enabled',
    video_recording: 'video_recording',
    startTime: 'startTime',
    endTime: 'endTime',
    failure_reason: 'failure_reason',
    is_profiling_available: 'is_profiling_available',
    device_info: 'device_info',
    device_udid: 'device_udid',
    device_platform: 'device_platform',
    device_version: 'device_version',
    device_name: 'device_name',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    performance_trace: 'performance_trace',
    failure_category: 'failure_category',
    ai_analysis: 'ai_analysis',
    tags: 'tags',
    trace_id: 'trace_id',
    last_heartbeat_at: 'last_heartbeat_at',
    heartbeat_pid: 'heartbeat_pid',
    heartbeat_host: 'heartbeat_host'
  };

  export type SessionScalarFieldEnum = (typeof SessionScalarFieldEnum)[keyof typeof SessionScalarFieldEnum]


  export const SessionLogScalarFieldEnum: {
    id: 'id',
    session_id: 'session_id',
    command_name: 'command_name',
    url: 'url',
    method: 'method',
    title: 'title',
    subtitle: 'subtitle',
    body: 'body',
    response: 'response',
    screenshot: 'screenshot',
    is_success: 'is_success',
    is_error: 'is_error',
    is_healed: 'is_healed',
    original_selector: 'original_selector',
    healed_selector: 'healed_selector',
    healing_confidence: 'healing_confidence',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    duration: 'duration',
    span_id: 'span_id',
    trace_id: 'trace_id'
  };

  export type SessionLogScalarFieldEnum = (typeof SessionLogScalarFieldEnum)[keyof typeof SessionLogScalarFieldEnum]


  export const LogScalarFieldEnum: {
    id: 'id',
    session_id: 'session_id',
    log_type: 'log_type',
    message: 'message',
    timestamp: 'timestamp',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type LogScalarFieldEnum = (typeof LogScalarFieldEnum)[keyof typeof LogScalarFieldEnum]


  export const ProfilingScalarFieldEnum: {
    id: 'id',
    session_id: 'session_id',
    cpu: 'cpu',
    memory: 'memory',
    total_cpu_used: 'total_cpu_used',
    total_memory_used: 'total_memory_used',
    raw_cpu_log: 'raw_cpu_log',
    raw_memory_log: 'raw_memory_log',
    timestamp: 'timestamp',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type ProfilingScalarFieldEnum = (typeof ProfilingScalarFieldEnum)[keyof typeof ProfilingScalarFieldEnum]


  export const AppScalarFieldEnum: {
    id: 'id',
    name: 'name',
    filename: 'filename',
    filepath: 'filepath',
    mimetype: 'mimetype',
    size: 'size',
    packageName: 'packageName',
    version: 'version',
    platform: 'platform',
    md5: 'md5',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type AppScalarFieldEnum = (typeof AppScalarFieldEnum)[keyof typeof AppScalarFieldEnum]


  export const DeviceScalarFieldEnum: {
    udid: 'udid',
    host: 'host',
    systemPort: 'systemPort',
    proxyPort: 'proxyPort',
    proxyHost: 'proxyHost',
    wdaLocalPort: 'wdaLocalPort',
    name: 'name',
    state: 'state',
    sdk: 'sdk',
    platform: 'platform',
    deviceType: 'deviceType',
    busy: 'busy',
    userBlocked: 'userBlocked',
    realDevice: 'realDevice',
    session_id: 'session_id',
    offline: 'offline',
    mjpegServerPort: 'mjpegServerPort',
    lastCmdExecutedAt: 'lastCmdExecutedAt',
    totalUtilizationTimeMilliSec: 'totalUtilizationTimeMilliSec',
    sessionStartTime: 'sessionStartTime',
    newCommandTimeout: 'newCommandTimeout',
    cloud: 'cloud',
    derivedDataPath: 'derivedDataPath',
    chromeDriverPath: 'chromeDriverPath',
    capability: 'capability',
    adbRemoteHost: 'adbRemoteHost',
    adbPort: 'adbPort',
    nodeId: 'nodeId',
    screenWidth: 'screenWidth',
    screenHeight: 'screenHeight',
    dashboard_link: 'dashboard_link',
    total_session_count: 'total_session_count',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    healthCheckError: 'healthCheckError',
    healthStatus: 'healthStatus',
    lastHealthCheckAt: 'lastHealthCheckAt',
    batteryLevel: 'batteryLevel',
    reservationReason: 'reservationReason',
    reservedBy: 'reservedBy',
    reservedUntil: 'reservedUntil',
    storageFree: 'storageFree',
    tags: 'tags',
    thermalStatus: 'thermalStatus',
    sessionProgress: 'sessionProgress',
    totalHealedCount: 'totalHealedCount',
    ip: 'ip',
    cpuArchitecture: 'cpuArchitecture',
    owning_session_id: 'owning_session_id',
    locked_at: 'locked_at'
  };

  export type DeviceScalarFieldEnum = (typeof DeviceScalarFieldEnum)[keyof typeof DeviceScalarFieldEnum]


  export const PendingSessionScalarFieldEnum: {
    id: 'id',
    capability_id: 'capability_id',
    capability: 'capability',
    createdAt: 'createdAt'
  };

  export type PendingSessionScalarFieldEnum = (typeof PendingSessionScalarFieldEnum)[keyof typeof PendingSessionScalarFieldEnum]


  export const CLIArgsScalarFieldEnum: {
    id: 'id',
    args: 'args',
    createdAt: 'createdAt'
  };

  export type CLIArgsScalarFieldEnum = (typeof CLIArgsScalarFieldEnum)[keyof typeof CLIArgsScalarFieldEnum]


  export const WebhookConfigScalarFieldEnum: {
    id: 'id',
    url: 'url',
    type: 'type',
    events: 'events',
    active: 'active',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    payloadTemplate: 'payloadTemplate'
  };

  export type WebhookConfigScalarFieldEnum = (typeof WebhookConfigScalarFieldEnum)[keyof typeof WebhookConfigScalarFieldEnum]


  export const WebConfigScalarFieldEnum: {
    id: 'id',
    name: 'name',
    value: 'value',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type WebConfigScalarFieldEnum = (typeof WebConfigScalarFieldEnum)[keyof typeof WebConfigScalarFieldEnum]


  export const LocatorEtalonScalarFieldEnum: {
    id: 'id',
    selector: 'selector',
    strategy: 'strategy',
    attributes: 'attributes',
    nodeName: 'nodeName',
    lastSeen: 'lastSeen',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type LocatorEtalonScalarFieldEnum = (typeof LocatorEtalonScalarFieldEnum)[keyof typeof LocatorEtalonScalarFieldEnum]


  export const SortOrder: {
    asc: 'asc',
    desc: 'desc'
  };

  export type SortOrder = (typeof SortOrder)[keyof typeof SortOrder]


  export const NullsOrder: {
    first: 'first',
    last: 'last'
  };

  export type NullsOrder = (typeof NullsOrder)[keyof typeof NullsOrder]


  /**
   * Field references 
   */


  /**
   * Reference to a field of type 'String'
   */
  export type StringFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'String'>
    


  /**
   * Reference to a field of type 'DateTime'
   */
  export type DateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime'>
    


  /**
   * Reference to a field of type 'Boolean'
   */
  export type BooleanFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Boolean'>
    


  /**
   * Reference to a field of type 'Int'
   */
  export type IntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int'>
    


  /**
   * Reference to a field of type 'Float'
   */
  export type FloatFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Float'>
    
  /**
   * Deep Input Types
   */


  export type BuildWhereInput = {
    AND?: BuildWhereInput | BuildWhereInput[]
    OR?: BuildWhereInput[]
    NOT?: BuildWhereInput | BuildWhereInput[]
    id?: StringFilter<"Build"> | string
    name?: StringNullableFilter<"Build"> | string | null
    createdAt?: DateTimeFilter<"Build"> | Date | string
    updatedAt?: DateTimeFilter<"Build"> | Date | string
    sessions?: SessionListRelationFilter
  }

  export type BuildOrderByWithRelationInput = {
    id?: SortOrder
    name?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    sessions?: SessionOrderByRelationAggregateInput
  }

  export type BuildWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: BuildWhereInput | BuildWhereInput[]
    OR?: BuildWhereInput[]
    NOT?: BuildWhereInput | BuildWhereInput[]
    name?: StringNullableFilter<"Build"> | string | null
    createdAt?: DateTimeFilter<"Build"> | Date | string
    updatedAt?: DateTimeFilter<"Build"> | Date | string
    sessions?: SessionListRelationFilter
  }, "id">

  export type BuildOrderByWithAggregationInput = {
    id?: SortOrder
    name?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: BuildCountOrderByAggregateInput
    _max?: BuildMaxOrderByAggregateInput
    _min?: BuildMinOrderByAggregateInput
  }

  export type BuildScalarWhereWithAggregatesInput = {
    AND?: BuildScalarWhereWithAggregatesInput | BuildScalarWhereWithAggregatesInput[]
    OR?: BuildScalarWhereWithAggregatesInput[]
    NOT?: BuildScalarWhereWithAggregatesInput | BuildScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"Build"> | string
    name?: StringNullableWithAggregatesFilter<"Build"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"Build"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Build"> | Date | string
  }

  export type SessionWhereInput = {
    AND?: SessionWhereInput | SessionWhereInput[]
    OR?: SessionWhereInput[]
    NOT?: SessionWhereInput | SessionWhereInput[]
    id?: StringFilter<"Session"> | string
    build_id?: StringNullableFilter<"Session"> | string | null
    name?: StringNullableFilter<"Session"> | string | null
    status?: StringFilter<"Session"> | string
    desired_capabilities?: StringFilter<"Session"> | string
    session_capabilities?: StringFilter<"Session"> | string
    node_id?: StringFilter<"Session"> | string
    has_live_video?: BoolFilter<"Session"> | boolean
    video_recording_enabled?: BoolFilter<"Session"> | boolean
    video_recording?: StringNullableFilter<"Session"> | string | null
    startTime?: DateTimeFilter<"Session"> | Date | string
    endTime?: DateTimeNullableFilter<"Session"> | Date | string | null
    failure_reason?: StringNullableFilter<"Session"> | string | null
    is_profiling_available?: BoolFilter<"Session"> | boolean
    device_info?: StringNullableFilter<"Session"> | string | null
    device_udid?: StringFilter<"Session"> | string
    device_platform?: StringFilter<"Session"> | string
    device_version?: StringFilter<"Session"> | string
    device_name?: StringNullableFilter<"Session"> | string | null
    createdAt?: DateTimeFilter<"Session"> | Date | string
    updatedAt?: DateTimeFilter<"Session"> | Date | string
    performance_trace?: StringNullableFilter<"Session"> | string | null
    failure_category?: StringNullableFilter<"Session"> | string | null
    ai_analysis?: StringNullableFilter<"Session"> | string | null
    tags?: StringNullableFilter<"Session"> | string | null
    trace_id?: StringNullableFilter<"Session"> | string | null
    last_heartbeat_at?: DateTimeNullableFilter<"Session"> | Date | string | null
    heartbeat_pid?: IntNullableFilter<"Session"> | number | null
    heartbeat_host?: StringNullableFilter<"Session"> | string | null
    Log?: LogListRelationFilter
    Profiling?: ProfilingListRelationFilter
    build?: XOR<BuildNullableRelationFilter, BuildWhereInput> | null
    SessionLog?: SessionLogListRelationFilter
  }

  export type SessionOrderByWithRelationInput = {
    id?: SortOrder
    build_id?: SortOrderInput | SortOrder
    name?: SortOrderInput | SortOrder
    status?: SortOrder
    desired_capabilities?: SortOrder
    session_capabilities?: SortOrder
    node_id?: SortOrder
    has_live_video?: SortOrder
    video_recording_enabled?: SortOrder
    video_recording?: SortOrderInput | SortOrder
    startTime?: SortOrder
    endTime?: SortOrderInput | SortOrder
    failure_reason?: SortOrderInput | SortOrder
    is_profiling_available?: SortOrder
    device_info?: SortOrderInput | SortOrder
    device_udid?: SortOrder
    device_platform?: SortOrder
    device_version?: SortOrder
    device_name?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    performance_trace?: SortOrderInput | SortOrder
    failure_category?: SortOrderInput | SortOrder
    ai_analysis?: SortOrderInput | SortOrder
    tags?: SortOrderInput | SortOrder
    trace_id?: SortOrderInput | SortOrder
    last_heartbeat_at?: SortOrderInput | SortOrder
    heartbeat_pid?: SortOrderInput | SortOrder
    heartbeat_host?: SortOrderInput | SortOrder
    Log?: LogOrderByRelationAggregateInput
    Profiling?: ProfilingOrderByRelationAggregateInput
    build?: BuildOrderByWithRelationInput
    SessionLog?: SessionLogOrderByRelationAggregateInput
  }

  export type SessionWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: SessionWhereInput | SessionWhereInput[]
    OR?: SessionWhereInput[]
    NOT?: SessionWhereInput | SessionWhereInput[]
    build_id?: StringNullableFilter<"Session"> | string | null
    name?: StringNullableFilter<"Session"> | string | null
    status?: StringFilter<"Session"> | string
    desired_capabilities?: StringFilter<"Session"> | string
    session_capabilities?: StringFilter<"Session"> | string
    node_id?: StringFilter<"Session"> | string
    has_live_video?: BoolFilter<"Session"> | boolean
    video_recording_enabled?: BoolFilter<"Session"> | boolean
    video_recording?: StringNullableFilter<"Session"> | string | null
    startTime?: DateTimeFilter<"Session"> | Date | string
    endTime?: DateTimeNullableFilter<"Session"> | Date | string | null
    failure_reason?: StringNullableFilter<"Session"> | string | null
    is_profiling_available?: BoolFilter<"Session"> | boolean
    device_info?: StringNullableFilter<"Session"> | string | null
    device_udid?: StringFilter<"Session"> | string
    device_platform?: StringFilter<"Session"> | string
    device_version?: StringFilter<"Session"> | string
    device_name?: StringNullableFilter<"Session"> | string | null
    createdAt?: DateTimeFilter<"Session"> | Date | string
    updatedAt?: DateTimeFilter<"Session"> | Date | string
    performance_trace?: StringNullableFilter<"Session"> | string | null
    failure_category?: StringNullableFilter<"Session"> | string | null
    ai_analysis?: StringNullableFilter<"Session"> | string | null
    tags?: StringNullableFilter<"Session"> | string | null
    trace_id?: StringNullableFilter<"Session"> | string | null
    last_heartbeat_at?: DateTimeNullableFilter<"Session"> | Date | string | null
    heartbeat_pid?: IntNullableFilter<"Session"> | number | null
    heartbeat_host?: StringNullableFilter<"Session"> | string | null
    Log?: LogListRelationFilter
    Profiling?: ProfilingListRelationFilter
    build?: XOR<BuildNullableRelationFilter, BuildWhereInput> | null
    SessionLog?: SessionLogListRelationFilter
  }, "id">

  export type SessionOrderByWithAggregationInput = {
    id?: SortOrder
    build_id?: SortOrderInput | SortOrder
    name?: SortOrderInput | SortOrder
    status?: SortOrder
    desired_capabilities?: SortOrder
    session_capabilities?: SortOrder
    node_id?: SortOrder
    has_live_video?: SortOrder
    video_recording_enabled?: SortOrder
    video_recording?: SortOrderInput | SortOrder
    startTime?: SortOrder
    endTime?: SortOrderInput | SortOrder
    failure_reason?: SortOrderInput | SortOrder
    is_profiling_available?: SortOrder
    device_info?: SortOrderInput | SortOrder
    device_udid?: SortOrder
    device_platform?: SortOrder
    device_version?: SortOrder
    device_name?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    performance_trace?: SortOrderInput | SortOrder
    failure_category?: SortOrderInput | SortOrder
    ai_analysis?: SortOrderInput | SortOrder
    tags?: SortOrderInput | SortOrder
    trace_id?: SortOrderInput | SortOrder
    last_heartbeat_at?: SortOrderInput | SortOrder
    heartbeat_pid?: SortOrderInput | SortOrder
    heartbeat_host?: SortOrderInput | SortOrder
    _count?: SessionCountOrderByAggregateInput
    _avg?: SessionAvgOrderByAggregateInput
    _max?: SessionMaxOrderByAggregateInput
    _min?: SessionMinOrderByAggregateInput
    _sum?: SessionSumOrderByAggregateInput
  }

  export type SessionScalarWhereWithAggregatesInput = {
    AND?: SessionScalarWhereWithAggregatesInput | SessionScalarWhereWithAggregatesInput[]
    OR?: SessionScalarWhereWithAggregatesInput[]
    NOT?: SessionScalarWhereWithAggregatesInput | SessionScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"Session"> | string
    build_id?: StringNullableWithAggregatesFilter<"Session"> | string | null
    name?: StringNullableWithAggregatesFilter<"Session"> | string | null
    status?: StringWithAggregatesFilter<"Session"> | string
    desired_capabilities?: StringWithAggregatesFilter<"Session"> | string
    session_capabilities?: StringWithAggregatesFilter<"Session"> | string
    node_id?: StringWithAggregatesFilter<"Session"> | string
    has_live_video?: BoolWithAggregatesFilter<"Session"> | boolean
    video_recording_enabled?: BoolWithAggregatesFilter<"Session"> | boolean
    video_recording?: StringNullableWithAggregatesFilter<"Session"> | string | null
    startTime?: DateTimeWithAggregatesFilter<"Session"> | Date | string
    endTime?: DateTimeNullableWithAggregatesFilter<"Session"> | Date | string | null
    failure_reason?: StringNullableWithAggregatesFilter<"Session"> | string | null
    is_profiling_available?: BoolWithAggregatesFilter<"Session"> | boolean
    device_info?: StringNullableWithAggregatesFilter<"Session"> | string | null
    device_udid?: StringWithAggregatesFilter<"Session"> | string
    device_platform?: StringWithAggregatesFilter<"Session"> | string
    device_version?: StringWithAggregatesFilter<"Session"> | string
    device_name?: StringNullableWithAggregatesFilter<"Session"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"Session"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Session"> | Date | string
    performance_trace?: StringNullableWithAggregatesFilter<"Session"> | string | null
    failure_category?: StringNullableWithAggregatesFilter<"Session"> | string | null
    ai_analysis?: StringNullableWithAggregatesFilter<"Session"> | string | null
    tags?: StringNullableWithAggregatesFilter<"Session"> | string | null
    trace_id?: StringNullableWithAggregatesFilter<"Session"> | string | null
    last_heartbeat_at?: DateTimeNullableWithAggregatesFilter<"Session"> | Date | string | null
    heartbeat_pid?: IntNullableWithAggregatesFilter<"Session"> | number | null
    heartbeat_host?: StringNullableWithAggregatesFilter<"Session"> | string | null
  }

  export type SessionLogWhereInput = {
    AND?: SessionLogWhereInput | SessionLogWhereInput[]
    OR?: SessionLogWhereInput[]
    NOT?: SessionLogWhereInput | SessionLogWhereInput[]
    id?: StringFilter<"SessionLog"> | string
    session_id?: StringFilter<"SessionLog"> | string
    command_name?: StringNullableFilter<"SessionLog"> | string | null
    url?: StringFilter<"SessionLog"> | string
    method?: StringFilter<"SessionLog"> | string
    title?: StringFilter<"SessionLog"> | string
    subtitle?: StringNullableFilter<"SessionLog"> | string | null
    body?: StringNullableFilter<"SessionLog"> | string | null
    response?: StringFilter<"SessionLog"> | string
    screenshot?: StringNullableFilter<"SessionLog"> | string | null
    is_success?: BoolNullableFilter<"SessionLog"> | boolean | null
    is_error?: BoolFilter<"SessionLog"> | boolean
    is_healed?: BoolFilter<"SessionLog"> | boolean
    original_selector?: StringNullableFilter<"SessionLog"> | string | null
    healed_selector?: StringNullableFilter<"SessionLog"> | string | null
    healing_confidence?: FloatNullableFilter<"SessionLog"> | number | null
    createdAt?: DateTimeFilter<"SessionLog"> | Date | string
    updatedAt?: DateTimeFilter<"SessionLog"> | Date | string
    duration?: IntNullableFilter<"SessionLog"> | number | null
    span_id?: StringNullableFilter<"SessionLog"> | string | null
    trace_id?: StringNullableFilter<"SessionLog"> | string | null
    session?: XOR<SessionRelationFilter, SessionWhereInput>
  }

  export type SessionLogOrderByWithRelationInput = {
    id?: SortOrder
    session_id?: SortOrder
    command_name?: SortOrderInput | SortOrder
    url?: SortOrder
    method?: SortOrder
    title?: SortOrder
    subtitle?: SortOrderInput | SortOrder
    body?: SortOrderInput | SortOrder
    response?: SortOrder
    screenshot?: SortOrderInput | SortOrder
    is_success?: SortOrderInput | SortOrder
    is_error?: SortOrder
    is_healed?: SortOrder
    original_selector?: SortOrderInput | SortOrder
    healed_selector?: SortOrderInput | SortOrder
    healing_confidence?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    duration?: SortOrderInput | SortOrder
    span_id?: SortOrderInput | SortOrder
    trace_id?: SortOrderInput | SortOrder
    session?: SessionOrderByWithRelationInput
  }

  export type SessionLogWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: SessionLogWhereInput | SessionLogWhereInput[]
    OR?: SessionLogWhereInput[]
    NOT?: SessionLogWhereInput | SessionLogWhereInput[]
    session_id?: StringFilter<"SessionLog"> | string
    command_name?: StringNullableFilter<"SessionLog"> | string | null
    url?: StringFilter<"SessionLog"> | string
    method?: StringFilter<"SessionLog"> | string
    title?: StringFilter<"SessionLog"> | string
    subtitle?: StringNullableFilter<"SessionLog"> | string | null
    body?: StringNullableFilter<"SessionLog"> | string | null
    response?: StringFilter<"SessionLog"> | string
    screenshot?: StringNullableFilter<"SessionLog"> | string | null
    is_success?: BoolNullableFilter<"SessionLog"> | boolean | null
    is_error?: BoolFilter<"SessionLog"> | boolean
    is_healed?: BoolFilter<"SessionLog"> | boolean
    original_selector?: StringNullableFilter<"SessionLog"> | string | null
    healed_selector?: StringNullableFilter<"SessionLog"> | string | null
    healing_confidence?: FloatNullableFilter<"SessionLog"> | number | null
    createdAt?: DateTimeFilter<"SessionLog"> | Date | string
    updatedAt?: DateTimeFilter<"SessionLog"> | Date | string
    duration?: IntNullableFilter<"SessionLog"> | number | null
    span_id?: StringNullableFilter<"SessionLog"> | string | null
    trace_id?: StringNullableFilter<"SessionLog"> | string | null
    session?: XOR<SessionRelationFilter, SessionWhereInput>
  }, "id">

  export type SessionLogOrderByWithAggregationInput = {
    id?: SortOrder
    session_id?: SortOrder
    command_name?: SortOrderInput | SortOrder
    url?: SortOrder
    method?: SortOrder
    title?: SortOrder
    subtitle?: SortOrderInput | SortOrder
    body?: SortOrderInput | SortOrder
    response?: SortOrder
    screenshot?: SortOrderInput | SortOrder
    is_success?: SortOrderInput | SortOrder
    is_error?: SortOrder
    is_healed?: SortOrder
    original_selector?: SortOrderInput | SortOrder
    healed_selector?: SortOrderInput | SortOrder
    healing_confidence?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    duration?: SortOrderInput | SortOrder
    span_id?: SortOrderInput | SortOrder
    trace_id?: SortOrderInput | SortOrder
    _count?: SessionLogCountOrderByAggregateInput
    _avg?: SessionLogAvgOrderByAggregateInput
    _max?: SessionLogMaxOrderByAggregateInput
    _min?: SessionLogMinOrderByAggregateInput
    _sum?: SessionLogSumOrderByAggregateInput
  }

  export type SessionLogScalarWhereWithAggregatesInput = {
    AND?: SessionLogScalarWhereWithAggregatesInput | SessionLogScalarWhereWithAggregatesInput[]
    OR?: SessionLogScalarWhereWithAggregatesInput[]
    NOT?: SessionLogScalarWhereWithAggregatesInput | SessionLogScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"SessionLog"> | string
    session_id?: StringWithAggregatesFilter<"SessionLog"> | string
    command_name?: StringNullableWithAggregatesFilter<"SessionLog"> | string | null
    url?: StringWithAggregatesFilter<"SessionLog"> | string
    method?: StringWithAggregatesFilter<"SessionLog"> | string
    title?: StringWithAggregatesFilter<"SessionLog"> | string
    subtitle?: StringNullableWithAggregatesFilter<"SessionLog"> | string | null
    body?: StringNullableWithAggregatesFilter<"SessionLog"> | string | null
    response?: StringWithAggregatesFilter<"SessionLog"> | string
    screenshot?: StringNullableWithAggregatesFilter<"SessionLog"> | string | null
    is_success?: BoolNullableWithAggregatesFilter<"SessionLog"> | boolean | null
    is_error?: BoolWithAggregatesFilter<"SessionLog"> | boolean
    is_healed?: BoolWithAggregatesFilter<"SessionLog"> | boolean
    original_selector?: StringNullableWithAggregatesFilter<"SessionLog"> | string | null
    healed_selector?: StringNullableWithAggregatesFilter<"SessionLog"> | string | null
    healing_confidence?: FloatNullableWithAggregatesFilter<"SessionLog"> | number | null
    createdAt?: DateTimeWithAggregatesFilter<"SessionLog"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"SessionLog"> | Date | string
    duration?: IntNullableWithAggregatesFilter<"SessionLog"> | number | null
    span_id?: StringNullableWithAggregatesFilter<"SessionLog"> | string | null
    trace_id?: StringNullableWithAggregatesFilter<"SessionLog"> | string | null
  }

  export type LogWhereInput = {
    AND?: LogWhereInput | LogWhereInput[]
    OR?: LogWhereInput[]
    NOT?: LogWhereInput | LogWhereInput[]
    id?: StringFilter<"Log"> | string
    session_id?: StringFilter<"Log"> | string
    log_type?: StringFilter<"Log"> | string
    message?: StringFilter<"Log"> | string
    timestamp?: DateTimeFilter<"Log"> | Date | string
    createdAt?: DateTimeFilter<"Log"> | Date | string
    updatedAt?: DateTimeFilter<"Log"> | Date | string
    session?: XOR<SessionRelationFilter, SessionWhereInput>
  }

  export type LogOrderByWithRelationInput = {
    id?: SortOrder
    session_id?: SortOrder
    log_type?: SortOrder
    message?: SortOrder
    timestamp?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    session?: SessionOrderByWithRelationInput
  }

  export type LogWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: LogWhereInput | LogWhereInput[]
    OR?: LogWhereInput[]
    NOT?: LogWhereInput | LogWhereInput[]
    session_id?: StringFilter<"Log"> | string
    log_type?: StringFilter<"Log"> | string
    message?: StringFilter<"Log"> | string
    timestamp?: DateTimeFilter<"Log"> | Date | string
    createdAt?: DateTimeFilter<"Log"> | Date | string
    updatedAt?: DateTimeFilter<"Log"> | Date | string
    session?: XOR<SessionRelationFilter, SessionWhereInput>
  }, "id">

  export type LogOrderByWithAggregationInput = {
    id?: SortOrder
    session_id?: SortOrder
    log_type?: SortOrder
    message?: SortOrder
    timestamp?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: LogCountOrderByAggregateInput
    _max?: LogMaxOrderByAggregateInput
    _min?: LogMinOrderByAggregateInput
  }

  export type LogScalarWhereWithAggregatesInput = {
    AND?: LogScalarWhereWithAggregatesInput | LogScalarWhereWithAggregatesInput[]
    OR?: LogScalarWhereWithAggregatesInput[]
    NOT?: LogScalarWhereWithAggregatesInput | LogScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"Log"> | string
    session_id?: StringWithAggregatesFilter<"Log"> | string
    log_type?: StringWithAggregatesFilter<"Log"> | string
    message?: StringWithAggregatesFilter<"Log"> | string
    timestamp?: DateTimeWithAggregatesFilter<"Log"> | Date | string
    createdAt?: DateTimeWithAggregatesFilter<"Log"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Log"> | Date | string
  }

  export type ProfilingWhereInput = {
    AND?: ProfilingWhereInput | ProfilingWhereInput[]
    OR?: ProfilingWhereInput[]
    NOT?: ProfilingWhereInput | ProfilingWhereInput[]
    id?: IntFilter<"Profiling"> | number
    session_id?: StringFilter<"Profiling"> | string
    cpu?: StringNullableFilter<"Profiling"> | string | null
    memory?: StringNullableFilter<"Profiling"> | string | null
    total_cpu_used?: StringNullableFilter<"Profiling"> | string | null
    total_memory_used?: StringNullableFilter<"Profiling"> | string | null
    raw_cpu_log?: StringNullableFilter<"Profiling"> | string | null
    raw_memory_log?: StringNullableFilter<"Profiling"> | string | null
    timestamp?: DateTimeFilter<"Profiling"> | Date | string
    createdAt?: DateTimeFilter<"Profiling"> | Date | string
    updatedAt?: DateTimeFilter<"Profiling"> | Date | string
    session?: XOR<SessionRelationFilter, SessionWhereInput>
  }

  export type ProfilingOrderByWithRelationInput = {
    id?: SortOrder
    session_id?: SortOrder
    cpu?: SortOrderInput | SortOrder
    memory?: SortOrderInput | SortOrder
    total_cpu_used?: SortOrderInput | SortOrder
    total_memory_used?: SortOrderInput | SortOrder
    raw_cpu_log?: SortOrderInput | SortOrder
    raw_memory_log?: SortOrderInput | SortOrder
    timestamp?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    session?: SessionOrderByWithRelationInput
  }

  export type ProfilingWhereUniqueInput = Prisma.AtLeast<{
    id?: number
    AND?: ProfilingWhereInput | ProfilingWhereInput[]
    OR?: ProfilingWhereInput[]
    NOT?: ProfilingWhereInput | ProfilingWhereInput[]
    session_id?: StringFilter<"Profiling"> | string
    cpu?: StringNullableFilter<"Profiling"> | string | null
    memory?: StringNullableFilter<"Profiling"> | string | null
    total_cpu_used?: StringNullableFilter<"Profiling"> | string | null
    total_memory_used?: StringNullableFilter<"Profiling"> | string | null
    raw_cpu_log?: StringNullableFilter<"Profiling"> | string | null
    raw_memory_log?: StringNullableFilter<"Profiling"> | string | null
    timestamp?: DateTimeFilter<"Profiling"> | Date | string
    createdAt?: DateTimeFilter<"Profiling"> | Date | string
    updatedAt?: DateTimeFilter<"Profiling"> | Date | string
    session?: XOR<SessionRelationFilter, SessionWhereInput>
  }, "id">

  export type ProfilingOrderByWithAggregationInput = {
    id?: SortOrder
    session_id?: SortOrder
    cpu?: SortOrderInput | SortOrder
    memory?: SortOrderInput | SortOrder
    total_cpu_used?: SortOrderInput | SortOrder
    total_memory_used?: SortOrderInput | SortOrder
    raw_cpu_log?: SortOrderInput | SortOrder
    raw_memory_log?: SortOrderInput | SortOrder
    timestamp?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: ProfilingCountOrderByAggregateInput
    _avg?: ProfilingAvgOrderByAggregateInput
    _max?: ProfilingMaxOrderByAggregateInput
    _min?: ProfilingMinOrderByAggregateInput
    _sum?: ProfilingSumOrderByAggregateInput
  }

  export type ProfilingScalarWhereWithAggregatesInput = {
    AND?: ProfilingScalarWhereWithAggregatesInput | ProfilingScalarWhereWithAggregatesInput[]
    OR?: ProfilingScalarWhereWithAggregatesInput[]
    NOT?: ProfilingScalarWhereWithAggregatesInput | ProfilingScalarWhereWithAggregatesInput[]
    id?: IntWithAggregatesFilter<"Profiling"> | number
    session_id?: StringWithAggregatesFilter<"Profiling"> | string
    cpu?: StringNullableWithAggregatesFilter<"Profiling"> | string | null
    memory?: StringNullableWithAggregatesFilter<"Profiling"> | string | null
    total_cpu_used?: StringNullableWithAggregatesFilter<"Profiling"> | string | null
    total_memory_used?: StringNullableWithAggregatesFilter<"Profiling"> | string | null
    raw_cpu_log?: StringNullableWithAggregatesFilter<"Profiling"> | string | null
    raw_memory_log?: StringNullableWithAggregatesFilter<"Profiling"> | string | null
    timestamp?: DateTimeWithAggregatesFilter<"Profiling"> | Date | string
    createdAt?: DateTimeWithAggregatesFilter<"Profiling"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Profiling"> | Date | string
  }

  export type AppWhereInput = {
    AND?: AppWhereInput | AppWhereInput[]
    OR?: AppWhereInput[]
    NOT?: AppWhereInput | AppWhereInput[]
    id?: StringFilter<"App"> | string
    name?: StringFilter<"App"> | string
    filename?: StringFilter<"App"> | string
    filepath?: StringFilter<"App"> | string
    mimetype?: StringFilter<"App"> | string
    size?: IntFilter<"App"> | number
    packageName?: StringNullableFilter<"App"> | string | null
    version?: StringNullableFilter<"App"> | string | null
    platform?: StringNullableFilter<"App"> | string | null
    md5?: StringNullableFilter<"App"> | string | null
    createdAt?: DateTimeFilter<"App"> | Date | string
    updatedAt?: DateTimeFilter<"App"> | Date | string
  }

  export type AppOrderByWithRelationInput = {
    id?: SortOrder
    name?: SortOrder
    filename?: SortOrder
    filepath?: SortOrder
    mimetype?: SortOrder
    size?: SortOrder
    packageName?: SortOrderInput | SortOrder
    version?: SortOrderInput | SortOrder
    platform?: SortOrderInput | SortOrder
    md5?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type AppWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    md5?: string
    AND?: AppWhereInput | AppWhereInput[]
    OR?: AppWhereInput[]
    NOT?: AppWhereInput | AppWhereInput[]
    name?: StringFilter<"App"> | string
    filename?: StringFilter<"App"> | string
    filepath?: StringFilter<"App"> | string
    mimetype?: StringFilter<"App"> | string
    size?: IntFilter<"App"> | number
    packageName?: StringNullableFilter<"App"> | string | null
    version?: StringNullableFilter<"App"> | string | null
    platform?: StringNullableFilter<"App"> | string | null
    createdAt?: DateTimeFilter<"App"> | Date | string
    updatedAt?: DateTimeFilter<"App"> | Date | string
  }, "id" | "md5">

  export type AppOrderByWithAggregationInput = {
    id?: SortOrder
    name?: SortOrder
    filename?: SortOrder
    filepath?: SortOrder
    mimetype?: SortOrder
    size?: SortOrder
    packageName?: SortOrderInput | SortOrder
    version?: SortOrderInput | SortOrder
    platform?: SortOrderInput | SortOrder
    md5?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: AppCountOrderByAggregateInput
    _avg?: AppAvgOrderByAggregateInput
    _max?: AppMaxOrderByAggregateInput
    _min?: AppMinOrderByAggregateInput
    _sum?: AppSumOrderByAggregateInput
  }

  export type AppScalarWhereWithAggregatesInput = {
    AND?: AppScalarWhereWithAggregatesInput | AppScalarWhereWithAggregatesInput[]
    OR?: AppScalarWhereWithAggregatesInput[]
    NOT?: AppScalarWhereWithAggregatesInput | AppScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"App"> | string
    name?: StringWithAggregatesFilter<"App"> | string
    filename?: StringWithAggregatesFilter<"App"> | string
    filepath?: StringWithAggregatesFilter<"App"> | string
    mimetype?: StringWithAggregatesFilter<"App"> | string
    size?: IntWithAggregatesFilter<"App"> | number
    packageName?: StringNullableWithAggregatesFilter<"App"> | string | null
    version?: StringNullableWithAggregatesFilter<"App"> | string | null
    platform?: StringNullableWithAggregatesFilter<"App"> | string | null
    md5?: StringNullableWithAggregatesFilter<"App"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"App"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"App"> | Date | string
  }

  export type DeviceWhereInput = {
    AND?: DeviceWhereInput | DeviceWhereInput[]
    OR?: DeviceWhereInput[]
    NOT?: DeviceWhereInput | DeviceWhereInput[]
    udid?: StringFilter<"Device"> | string
    host?: StringFilter<"Device"> | string
    systemPort?: IntNullableFilter<"Device"> | number | null
    proxyPort?: IntNullableFilter<"Device"> | number | null
    proxyHost?: StringNullableFilter<"Device"> | string | null
    wdaLocalPort?: IntNullableFilter<"Device"> | number | null
    name?: StringNullableFilter<"Device"> | string | null
    state?: StringNullableFilter<"Device"> | string | null
    sdk?: StringNullableFilter<"Device"> | string | null
    platform?: StringNullableFilter<"Device"> | string | null
    deviceType?: StringNullableFilter<"Device"> | string | null
    busy?: BoolNullableFilter<"Device"> | boolean | null
    userBlocked?: BoolNullableFilter<"Device"> | boolean | null
    realDevice?: BoolNullableFilter<"Device"> | boolean | null
    session_id?: StringNullableFilter<"Device"> | string | null
    offline?: BoolNullableFilter<"Device"> | boolean | null
    mjpegServerPort?: IntNullableFilter<"Device"> | number | null
    lastCmdExecutedAt?: FloatNullableFilter<"Device"> | number | null
    totalUtilizationTimeMilliSec?: FloatFilter<"Device"> | number
    sessionStartTime?: FloatFilter<"Device"> | number
    newCommandTimeout?: IntNullableFilter<"Device"> | number | null
    cloud?: StringNullableFilter<"Device"> | string | null
    derivedDataPath?: StringNullableFilter<"Device"> | string | null
    chromeDriverPath?: StringNullableFilter<"Device"> | string | null
    capability?: StringNullableFilter<"Device"> | string | null
    adbRemoteHost?: StringNullableFilter<"Device"> | string | null
    adbPort?: IntNullableFilter<"Device"> | number | null
    nodeId?: StringNullableFilter<"Device"> | string | null
    screenWidth?: StringNullableFilter<"Device"> | string | null
    screenHeight?: StringNullableFilter<"Device"> | string | null
    dashboard_link?: StringNullableFilter<"Device"> | string | null
    total_session_count?: IntNullableFilter<"Device"> | number | null
    createdAt?: DateTimeFilter<"Device"> | Date | string
    updatedAt?: DateTimeFilter<"Device"> | Date | string
    healthCheckError?: StringNullableFilter<"Device"> | string | null
    healthStatus?: StringNullableFilter<"Device"> | string | null
    lastHealthCheckAt?: FloatNullableFilter<"Device"> | number | null
    batteryLevel?: IntNullableFilter<"Device"> | number | null
    reservationReason?: StringNullableFilter<"Device"> | string | null
    reservedBy?: StringNullableFilter<"Device"> | string | null
    reservedUntil?: FloatNullableFilter<"Device"> | number | null
    storageFree?: StringNullableFilter<"Device"> | string | null
    tags?: StringNullableFilter<"Device"> | string | null
    thermalStatus?: StringNullableFilter<"Device"> | string | null
    sessionProgress?: StringNullableFilter<"Device"> | string | null
    totalHealedCount?: IntNullableFilter<"Device"> | number | null
    ip?: StringNullableFilter<"Device"> | string | null
    cpuArchitecture?: StringNullableFilter<"Device"> | string | null
    owning_session_id?: StringNullableFilter<"Device"> | string | null
    locked_at?: FloatNullableFilter<"Device"> | number | null
  }

  export type DeviceOrderByWithRelationInput = {
    udid?: SortOrder
    host?: SortOrder
    systemPort?: SortOrderInput | SortOrder
    proxyPort?: SortOrderInput | SortOrder
    proxyHost?: SortOrderInput | SortOrder
    wdaLocalPort?: SortOrderInput | SortOrder
    name?: SortOrderInput | SortOrder
    state?: SortOrderInput | SortOrder
    sdk?: SortOrderInput | SortOrder
    platform?: SortOrderInput | SortOrder
    deviceType?: SortOrderInput | SortOrder
    busy?: SortOrderInput | SortOrder
    userBlocked?: SortOrderInput | SortOrder
    realDevice?: SortOrderInput | SortOrder
    session_id?: SortOrderInput | SortOrder
    offline?: SortOrderInput | SortOrder
    mjpegServerPort?: SortOrderInput | SortOrder
    lastCmdExecutedAt?: SortOrderInput | SortOrder
    totalUtilizationTimeMilliSec?: SortOrder
    sessionStartTime?: SortOrder
    newCommandTimeout?: SortOrderInput | SortOrder
    cloud?: SortOrderInput | SortOrder
    derivedDataPath?: SortOrderInput | SortOrder
    chromeDriverPath?: SortOrderInput | SortOrder
    capability?: SortOrderInput | SortOrder
    adbRemoteHost?: SortOrderInput | SortOrder
    adbPort?: SortOrderInput | SortOrder
    nodeId?: SortOrderInput | SortOrder
    screenWidth?: SortOrderInput | SortOrder
    screenHeight?: SortOrderInput | SortOrder
    dashboard_link?: SortOrderInput | SortOrder
    total_session_count?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    healthCheckError?: SortOrderInput | SortOrder
    healthStatus?: SortOrderInput | SortOrder
    lastHealthCheckAt?: SortOrderInput | SortOrder
    batteryLevel?: SortOrderInput | SortOrder
    reservationReason?: SortOrderInput | SortOrder
    reservedBy?: SortOrderInput | SortOrder
    reservedUntil?: SortOrderInput | SortOrder
    storageFree?: SortOrderInput | SortOrder
    tags?: SortOrderInput | SortOrder
    thermalStatus?: SortOrderInput | SortOrder
    sessionProgress?: SortOrderInput | SortOrder
    totalHealedCount?: SortOrderInput | SortOrder
    ip?: SortOrderInput | SortOrder
    cpuArchitecture?: SortOrderInput | SortOrder
    owning_session_id?: SortOrderInput | SortOrder
    locked_at?: SortOrderInput | SortOrder
  }

  export type DeviceWhereUniqueInput = Prisma.AtLeast<{
    udid_host?: DeviceUdidHostCompoundUniqueInput
    AND?: DeviceWhereInput | DeviceWhereInput[]
    OR?: DeviceWhereInput[]
    NOT?: DeviceWhereInput | DeviceWhereInput[]
    udid?: StringFilter<"Device"> | string
    host?: StringFilter<"Device"> | string
    systemPort?: IntNullableFilter<"Device"> | number | null
    proxyPort?: IntNullableFilter<"Device"> | number | null
    proxyHost?: StringNullableFilter<"Device"> | string | null
    wdaLocalPort?: IntNullableFilter<"Device"> | number | null
    name?: StringNullableFilter<"Device"> | string | null
    state?: StringNullableFilter<"Device"> | string | null
    sdk?: StringNullableFilter<"Device"> | string | null
    platform?: StringNullableFilter<"Device"> | string | null
    deviceType?: StringNullableFilter<"Device"> | string | null
    busy?: BoolNullableFilter<"Device"> | boolean | null
    userBlocked?: BoolNullableFilter<"Device"> | boolean | null
    realDevice?: BoolNullableFilter<"Device"> | boolean | null
    session_id?: StringNullableFilter<"Device"> | string | null
    offline?: BoolNullableFilter<"Device"> | boolean | null
    mjpegServerPort?: IntNullableFilter<"Device"> | number | null
    lastCmdExecutedAt?: FloatNullableFilter<"Device"> | number | null
    totalUtilizationTimeMilliSec?: FloatFilter<"Device"> | number
    sessionStartTime?: FloatFilter<"Device"> | number
    newCommandTimeout?: IntNullableFilter<"Device"> | number | null
    cloud?: StringNullableFilter<"Device"> | string | null
    derivedDataPath?: StringNullableFilter<"Device"> | string | null
    chromeDriverPath?: StringNullableFilter<"Device"> | string | null
    capability?: StringNullableFilter<"Device"> | string | null
    adbRemoteHost?: StringNullableFilter<"Device"> | string | null
    adbPort?: IntNullableFilter<"Device"> | number | null
    nodeId?: StringNullableFilter<"Device"> | string | null
    screenWidth?: StringNullableFilter<"Device"> | string | null
    screenHeight?: StringNullableFilter<"Device"> | string | null
    dashboard_link?: StringNullableFilter<"Device"> | string | null
    total_session_count?: IntNullableFilter<"Device"> | number | null
    createdAt?: DateTimeFilter<"Device"> | Date | string
    updatedAt?: DateTimeFilter<"Device"> | Date | string
    healthCheckError?: StringNullableFilter<"Device"> | string | null
    healthStatus?: StringNullableFilter<"Device"> | string | null
    lastHealthCheckAt?: FloatNullableFilter<"Device"> | number | null
    batteryLevel?: IntNullableFilter<"Device"> | number | null
    reservationReason?: StringNullableFilter<"Device"> | string | null
    reservedBy?: StringNullableFilter<"Device"> | string | null
    reservedUntil?: FloatNullableFilter<"Device"> | number | null
    storageFree?: StringNullableFilter<"Device"> | string | null
    tags?: StringNullableFilter<"Device"> | string | null
    thermalStatus?: StringNullableFilter<"Device"> | string | null
    sessionProgress?: StringNullableFilter<"Device"> | string | null
    totalHealedCount?: IntNullableFilter<"Device"> | number | null
    ip?: StringNullableFilter<"Device"> | string | null
    cpuArchitecture?: StringNullableFilter<"Device"> | string | null
    owning_session_id?: StringNullableFilter<"Device"> | string | null
    locked_at?: FloatNullableFilter<"Device"> | number | null
  }, "udid_host">

  export type DeviceOrderByWithAggregationInput = {
    udid?: SortOrder
    host?: SortOrder
    systemPort?: SortOrderInput | SortOrder
    proxyPort?: SortOrderInput | SortOrder
    proxyHost?: SortOrderInput | SortOrder
    wdaLocalPort?: SortOrderInput | SortOrder
    name?: SortOrderInput | SortOrder
    state?: SortOrderInput | SortOrder
    sdk?: SortOrderInput | SortOrder
    platform?: SortOrderInput | SortOrder
    deviceType?: SortOrderInput | SortOrder
    busy?: SortOrderInput | SortOrder
    userBlocked?: SortOrderInput | SortOrder
    realDevice?: SortOrderInput | SortOrder
    session_id?: SortOrderInput | SortOrder
    offline?: SortOrderInput | SortOrder
    mjpegServerPort?: SortOrderInput | SortOrder
    lastCmdExecutedAt?: SortOrderInput | SortOrder
    totalUtilizationTimeMilliSec?: SortOrder
    sessionStartTime?: SortOrder
    newCommandTimeout?: SortOrderInput | SortOrder
    cloud?: SortOrderInput | SortOrder
    derivedDataPath?: SortOrderInput | SortOrder
    chromeDriverPath?: SortOrderInput | SortOrder
    capability?: SortOrderInput | SortOrder
    adbRemoteHost?: SortOrderInput | SortOrder
    adbPort?: SortOrderInput | SortOrder
    nodeId?: SortOrderInput | SortOrder
    screenWidth?: SortOrderInput | SortOrder
    screenHeight?: SortOrderInput | SortOrder
    dashboard_link?: SortOrderInput | SortOrder
    total_session_count?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    healthCheckError?: SortOrderInput | SortOrder
    healthStatus?: SortOrderInput | SortOrder
    lastHealthCheckAt?: SortOrderInput | SortOrder
    batteryLevel?: SortOrderInput | SortOrder
    reservationReason?: SortOrderInput | SortOrder
    reservedBy?: SortOrderInput | SortOrder
    reservedUntil?: SortOrderInput | SortOrder
    storageFree?: SortOrderInput | SortOrder
    tags?: SortOrderInput | SortOrder
    thermalStatus?: SortOrderInput | SortOrder
    sessionProgress?: SortOrderInput | SortOrder
    totalHealedCount?: SortOrderInput | SortOrder
    ip?: SortOrderInput | SortOrder
    cpuArchitecture?: SortOrderInput | SortOrder
    owning_session_id?: SortOrderInput | SortOrder
    locked_at?: SortOrderInput | SortOrder
    _count?: DeviceCountOrderByAggregateInput
    _avg?: DeviceAvgOrderByAggregateInput
    _max?: DeviceMaxOrderByAggregateInput
    _min?: DeviceMinOrderByAggregateInput
    _sum?: DeviceSumOrderByAggregateInput
  }

  export type DeviceScalarWhereWithAggregatesInput = {
    AND?: DeviceScalarWhereWithAggregatesInput | DeviceScalarWhereWithAggregatesInput[]
    OR?: DeviceScalarWhereWithAggregatesInput[]
    NOT?: DeviceScalarWhereWithAggregatesInput | DeviceScalarWhereWithAggregatesInput[]
    udid?: StringWithAggregatesFilter<"Device"> | string
    host?: StringWithAggregatesFilter<"Device"> | string
    systemPort?: IntNullableWithAggregatesFilter<"Device"> | number | null
    proxyPort?: IntNullableWithAggregatesFilter<"Device"> | number | null
    proxyHost?: StringNullableWithAggregatesFilter<"Device"> | string | null
    wdaLocalPort?: IntNullableWithAggregatesFilter<"Device"> | number | null
    name?: StringNullableWithAggregatesFilter<"Device"> | string | null
    state?: StringNullableWithAggregatesFilter<"Device"> | string | null
    sdk?: StringNullableWithAggregatesFilter<"Device"> | string | null
    platform?: StringNullableWithAggregatesFilter<"Device"> | string | null
    deviceType?: StringNullableWithAggregatesFilter<"Device"> | string | null
    busy?: BoolNullableWithAggregatesFilter<"Device"> | boolean | null
    userBlocked?: BoolNullableWithAggregatesFilter<"Device"> | boolean | null
    realDevice?: BoolNullableWithAggregatesFilter<"Device"> | boolean | null
    session_id?: StringNullableWithAggregatesFilter<"Device"> | string | null
    offline?: BoolNullableWithAggregatesFilter<"Device"> | boolean | null
    mjpegServerPort?: IntNullableWithAggregatesFilter<"Device"> | number | null
    lastCmdExecutedAt?: FloatNullableWithAggregatesFilter<"Device"> | number | null
    totalUtilizationTimeMilliSec?: FloatWithAggregatesFilter<"Device"> | number
    sessionStartTime?: FloatWithAggregatesFilter<"Device"> | number
    newCommandTimeout?: IntNullableWithAggregatesFilter<"Device"> | number | null
    cloud?: StringNullableWithAggregatesFilter<"Device"> | string | null
    derivedDataPath?: StringNullableWithAggregatesFilter<"Device"> | string | null
    chromeDriverPath?: StringNullableWithAggregatesFilter<"Device"> | string | null
    capability?: StringNullableWithAggregatesFilter<"Device"> | string | null
    adbRemoteHost?: StringNullableWithAggregatesFilter<"Device"> | string | null
    adbPort?: IntNullableWithAggregatesFilter<"Device"> | number | null
    nodeId?: StringNullableWithAggregatesFilter<"Device"> | string | null
    screenWidth?: StringNullableWithAggregatesFilter<"Device"> | string | null
    screenHeight?: StringNullableWithAggregatesFilter<"Device"> | string | null
    dashboard_link?: StringNullableWithAggregatesFilter<"Device"> | string | null
    total_session_count?: IntNullableWithAggregatesFilter<"Device"> | number | null
    createdAt?: DateTimeWithAggregatesFilter<"Device"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Device"> | Date | string
    healthCheckError?: StringNullableWithAggregatesFilter<"Device"> | string | null
    healthStatus?: StringNullableWithAggregatesFilter<"Device"> | string | null
    lastHealthCheckAt?: FloatNullableWithAggregatesFilter<"Device"> | number | null
    batteryLevel?: IntNullableWithAggregatesFilter<"Device"> | number | null
    reservationReason?: StringNullableWithAggregatesFilter<"Device"> | string | null
    reservedBy?: StringNullableWithAggregatesFilter<"Device"> | string | null
    reservedUntil?: FloatNullableWithAggregatesFilter<"Device"> | number | null
    storageFree?: StringNullableWithAggregatesFilter<"Device"> | string | null
    tags?: StringNullableWithAggregatesFilter<"Device"> | string | null
    thermalStatus?: StringNullableWithAggregatesFilter<"Device"> | string | null
    sessionProgress?: StringNullableWithAggregatesFilter<"Device"> | string | null
    totalHealedCount?: IntNullableWithAggregatesFilter<"Device"> | number | null
    ip?: StringNullableWithAggregatesFilter<"Device"> | string | null
    cpuArchitecture?: StringNullableWithAggregatesFilter<"Device"> | string | null
    owning_session_id?: StringNullableWithAggregatesFilter<"Device"> | string | null
    locked_at?: FloatNullableWithAggregatesFilter<"Device"> | number | null
  }

  export type PendingSessionWhereInput = {
    AND?: PendingSessionWhereInput | PendingSessionWhereInput[]
    OR?: PendingSessionWhereInput[]
    NOT?: PendingSessionWhereInput | PendingSessionWhereInput[]
    id?: IntFilter<"PendingSession"> | number
    capability_id?: StringFilter<"PendingSession"> | string
    capability?: StringFilter<"PendingSession"> | string
    createdAt?: FloatFilter<"PendingSession"> | number
  }

  export type PendingSessionOrderByWithRelationInput = {
    id?: SortOrder
    capability_id?: SortOrder
    capability?: SortOrder
    createdAt?: SortOrder
  }

  export type PendingSessionWhereUniqueInput = Prisma.AtLeast<{
    id?: number
    capability_id?: string
    AND?: PendingSessionWhereInput | PendingSessionWhereInput[]
    OR?: PendingSessionWhereInput[]
    NOT?: PendingSessionWhereInput | PendingSessionWhereInput[]
    capability?: StringFilter<"PendingSession"> | string
    createdAt?: FloatFilter<"PendingSession"> | number
  }, "id" | "capability_id">

  export type PendingSessionOrderByWithAggregationInput = {
    id?: SortOrder
    capability_id?: SortOrder
    capability?: SortOrder
    createdAt?: SortOrder
    _count?: PendingSessionCountOrderByAggregateInput
    _avg?: PendingSessionAvgOrderByAggregateInput
    _max?: PendingSessionMaxOrderByAggregateInput
    _min?: PendingSessionMinOrderByAggregateInput
    _sum?: PendingSessionSumOrderByAggregateInput
  }

  export type PendingSessionScalarWhereWithAggregatesInput = {
    AND?: PendingSessionScalarWhereWithAggregatesInput | PendingSessionScalarWhereWithAggregatesInput[]
    OR?: PendingSessionScalarWhereWithAggregatesInput[]
    NOT?: PendingSessionScalarWhereWithAggregatesInput | PendingSessionScalarWhereWithAggregatesInput[]
    id?: IntWithAggregatesFilter<"PendingSession"> | number
    capability_id?: StringWithAggregatesFilter<"PendingSession"> | string
    capability?: StringWithAggregatesFilter<"PendingSession"> | string
    createdAt?: FloatWithAggregatesFilter<"PendingSession"> | number
  }

  export type CLIArgsWhereInput = {
    AND?: CLIArgsWhereInput | CLIArgsWhereInput[]
    OR?: CLIArgsWhereInput[]
    NOT?: CLIArgsWhereInput | CLIArgsWhereInput[]
    id?: IntFilter<"CLIArgs"> | number
    args?: StringFilter<"CLIArgs"> | string
    createdAt?: DateTimeFilter<"CLIArgs"> | Date | string
  }

  export type CLIArgsOrderByWithRelationInput = {
    id?: SortOrder
    args?: SortOrder
    createdAt?: SortOrder
  }

  export type CLIArgsWhereUniqueInput = Prisma.AtLeast<{
    id?: number
    AND?: CLIArgsWhereInput | CLIArgsWhereInput[]
    OR?: CLIArgsWhereInput[]
    NOT?: CLIArgsWhereInput | CLIArgsWhereInput[]
    args?: StringFilter<"CLIArgs"> | string
    createdAt?: DateTimeFilter<"CLIArgs"> | Date | string
  }, "id">

  export type CLIArgsOrderByWithAggregationInput = {
    id?: SortOrder
    args?: SortOrder
    createdAt?: SortOrder
    _count?: CLIArgsCountOrderByAggregateInput
    _avg?: CLIArgsAvgOrderByAggregateInput
    _max?: CLIArgsMaxOrderByAggregateInput
    _min?: CLIArgsMinOrderByAggregateInput
    _sum?: CLIArgsSumOrderByAggregateInput
  }

  export type CLIArgsScalarWhereWithAggregatesInput = {
    AND?: CLIArgsScalarWhereWithAggregatesInput | CLIArgsScalarWhereWithAggregatesInput[]
    OR?: CLIArgsScalarWhereWithAggregatesInput[]
    NOT?: CLIArgsScalarWhereWithAggregatesInput | CLIArgsScalarWhereWithAggregatesInput[]
    id?: IntWithAggregatesFilter<"CLIArgs"> | number
    args?: StringWithAggregatesFilter<"CLIArgs"> | string
    createdAt?: DateTimeWithAggregatesFilter<"CLIArgs"> | Date | string
  }

  export type WebhookConfigWhereInput = {
    AND?: WebhookConfigWhereInput | WebhookConfigWhereInput[]
    OR?: WebhookConfigWhereInput[]
    NOT?: WebhookConfigWhereInput | WebhookConfigWhereInput[]
    id?: StringFilter<"WebhookConfig"> | string
    url?: StringFilter<"WebhookConfig"> | string
    type?: StringFilter<"WebhookConfig"> | string
    events?: StringFilter<"WebhookConfig"> | string
    active?: BoolFilter<"WebhookConfig"> | boolean
    createdAt?: DateTimeFilter<"WebhookConfig"> | Date | string
    updatedAt?: DateTimeFilter<"WebhookConfig"> | Date | string
    payloadTemplate?: StringNullableFilter<"WebhookConfig"> | string | null
  }

  export type WebhookConfigOrderByWithRelationInput = {
    id?: SortOrder
    url?: SortOrder
    type?: SortOrder
    events?: SortOrder
    active?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    payloadTemplate?: SortOrderInput | SortOrder
  }

  export type WebhookConfigWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: WebhookConfigWhereInput | WebhookConfigWhereInput[]
    OR?: WebhookConfigWhereInput[]
    NOT?: WebhookConfigWhereInput | WebhookConfigWhereInput[]
    url?: StringFilter<"WebhookConfig"> | string
    type?: StringFilter<"WebhookConfig"> | string
    events?: StringFilter<"WebhookConfig"> | string
    active?: BoolFilter<"WebhookConfig"> | boolean
    createdAt?: DateTimeFilter<"WebhookConfig"> | Date | string
    updatedAt?: DateTimeFilter<"WebhookConfig"> | Date | string
    payloadTemplate?: StringNullableFilter<"WebhookConfig"> | string | null
  }, "id">

  export type WebhookConfigOrderByWithAggregationInput = {
    id?: SortOrder
    url?: SortOrder
    type?: SortOrder
    events?: SortOrder
    active?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    payloadTemplate?: SortOrderInput | SortOrder
    _count?: WebhookConfigCountOrderByAggregateInput
    _max?: WebhookConfigMaxOrderByAggregateInput
    _min?: WebhookConfigMinOrderByAggregateInput
  }

  export type WebhookConfigScalarWhereWithAggregatesInput = {
    AND?: WebhookConfigScalarWhereWithAggregatesInput | WebhookConfigScalarWhereWithAggregatesInput[]
    OR?: WebhookConfigScalarWhereWithAggregatesInput[]
    NOT?: WebhookConfigScalarWhereWithAggregatesInput | WebhookConfigScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"WebhookConfig"> | string
    url?: StringWithAggregatesFilter<"WebhookConfig"> | string
    type?: StringWithAggregatesFilter<"WebhookConfig"> | string
    events?: StringWithAggregatesFilter<"WebhookConfig"> | string
    active?: BoolWithAggregatesFilter<"WebhookConfig"> | boolean
    createdAt?: DateTimeWithAggregatesFilter<"WebhookConfig"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"WebhookConfig"> | Date | string
    payloadTemplate?: StringNullableWithAggregatesFilter<"WebhookConfig"> | string | null
  }

  export type WebConfigWhereInput = {
    AND?: WebConfigWhereInput | WebConfigWhereInput[]
    OR?: WebConfigWhereInput[]
    NOT?: WebConfigWhereInput | WebConfigWhereInput[]
    id?: StringFilter<"WebConfig"> | string
    name?: StringFilter<"WebConfig"> | string
    value?: StringFilter<"WebConfig"> | string
    createdAt?: DateTimeFilter<"WebConfig"> | Date | string
    updatedAt?: DateTimeFilter<"WebConfig"> | Date | string
  }

  export type WebConfigOrderByWithRelationInput = {
    id?: SortOrder
    name?: SortOrder
    value?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type WebConfigWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    name?: string
    AND?: WebConfigWhereInput | WebConfigWhereInput[]
    OR?: WebConfigWhereInput[]
    NOT?: WebConfigWhereInput | WebConfigWhereInput[]
    value?: StringFilter<"WebConfig"> | string
    createdAt?: DateTimeFilter<"WebConfig"> | Date | string
    updatedAt?: DateTimeFilter<"WebConfig"> | Date | string
  }, "id" | "name">

  export type WebConfigOrderByWithAggregationInput = {
    id?: SortOrder
    name?: SortOrder
    value?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: WebConfigCountOrderByAggregateInput
    _max?: WebConfigMaxOrderByAggregateInput
    _min?: WebConfigMinOrderByAggregateInput
  }

  export type WebConfigScalarWhereWithAggregatesInput = {
    AND?: WebConfigScalarWhereWithAggregatesInput | WebConfigScalarWhereWithAggregatesInput[]
    OR?: WebConfigScalarWhereWithAggregatesInput[]
    NOT?: WebConfigScalarWhereWithAggregatesInput | WebConfigScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"WebConfig"> | string
    name?: StringWithAggregatesFilter<"WebConfig"> | string
    value?: StringWithAggregatesFilter<"WebConfig"> | string
    createdAt?: DateTimeWithAggregatesFilter<"WebConfig"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"WebConfig"> | Date | string
  }

  export type LocatorEtalonWhereInput = {
    AND?: LocatorEtalonWhereInput | LocatorEtalonWhereInput[]
    OR?: LocatorEtalonWhereInput[]
    NOT?: LocatorEtalonWhereInput | LocatorEtalonWhereInput[]
    id?: StringFilter<"LocatorEtalon"> | string
    selector?: StringFilter<"LocatorEtalon"> | string
    strategy?: StringFilter<"LocatorEtalon"> | string
    attributes?: StringFilter<"LocatorEtalon"> | string
    nodeName?: StringFilter<"LocatorEtalon"> | string
    lastSeen?: DateTimeFilter<"LocatorEtalon"> | Date | string
    createdAt?: DateTimeFilter<"LocatorEtalon"> | Date | string
    updatedAt?: DateTimeFilter<"LocatorEtalon"> | Date | string
  }

  export type LocatorEtalonOrderByWithRelationInput = {
    id?: SortOrder
    selector?: SortOrder
    strategy?: SortOrder
    attributes?: SortOrder
    nodeName?: SortOrder
    lastSeen?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type LocatorEtalonWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    selector?: string
    AND?: LocatorEtalonWhereInput | LocatorEtalonWhereInput[]
    OR?: LocatorEtalonWhereInput[]
    NOT?: LocatorEtalonWhereInput | LocatorEtalonWhereInput[]
    strategy?: StringFilter<"LocatorEtalon"> | string
    attributes?: StringFilter<"LocatorEtalon"> | string
    nodeName?: StringFilter<"LocatorEtalon"> | string
    lastSeen?: DateTimeFilter<"LocatorEtalon"> | Date | string
    createdAt?: DateTimeFilter<"LocatorEtalon"> | Date | string
    updatedAt?: DateTimeFilter<"LocatorEtalon"> | Date | string
  }, "id" | "selector">

  export type LocatorEtalonOrderByWithAggregationInput = {
    id?: SortOrder
    selector?: SortOrder
    strategy?: SortOrder
    attributes?: SortOrder
    nodeName?: SortOrder
    lastSeen?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: LocatorEtalonCountOrderByAggregateInput
    _max?: LocatorEtalonMaxOrderByAggregateInput
    _min?: LocatorEtalonMinOrderByAggregateInput
  }

  export type LocatorEtalonScalarWhereWithAggregatesInput = {
    AND?: LocatorEtalonScalarWhereWithAggregatesInput | LocatorEtalonScalarWhereWithAggregatesInput[]
    OR?: LocatorEtalonScalarWhereWithAggregatesInput[]
    NOT?: LocatorEtalonScalarWhereWithAggregatesInput | LocatorEtalonScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"LocatorEtalon"> | string
    selector?: StringWithAggregatesFilter<"LocatorEtalon"> | string
    strategy?: StringWithAggregatesFilter<"LocatorEtalon"> | string
    attributes?: StringWithAggregatesFilter<"LocatorEtalon"> | string
    nodeName?: StringWithAggregatesFilter<"LocatorEtalon"> | string
    lastSeen?: DateTimeWithAggregatesFilter<"LocatorEtalon"> | Date | string
    createdAt?: DateTimeWithAggregatesFilter<"LocatorEtalon"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"LocatorEtalon"> | Date | string
  }

  export type BuildCreateInput = {
    id?: string
    name?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    sessions?: SessionCreateNestedManyWithoutBuildInput
  }

  export type BuildUncheckedCreateInput = {
    id?: string
    name?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    sessions?: SessionUncheckedCreateNestedManyWithoutBuildInput
  }

  export type BuildUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    sessions?: SessionUpdateManyWithoutBuildNestedInput
  }

  export type BuildUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    sessions?: SessionUncheckedUpdateManyWithoutBuildNestedInput
  }

  export type BuildCreateManyInput = {
    id?: string
    name?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type BuildUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type BuildUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type SessionCreateInput = {
    id: string
    name?: string | null
    status?: string
    desired_capabilities: string
    session_capabilities: string
    node_id: string
    has_live_video: boolean
    video_recording_enabled?: boolean
    video_recording?: string | null
    startTime?: Date | string
    endTime?: Date | string | null
    failure_reason?: string | null
    is_profiling_available?: boolean
    device_info?: string | null
    device_udid: string
    device_platform: string
    device_version: string
    device_name?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    performance_trace?: string | null
    failure_category?: string | null
    ai_analysis?: string | null
    tags?: string | null
    trace_id?: string | null
    last_heartbeat_at?: Date | string | null
    heartbeat_pid?: number | null
    heartbeat_host?: string | null
    Log?: LogCreateNestedManyWithoutSessionInput
    Profiling?: ProfilingCreateNestedManyWithoutSessionInput
    build?: BuildCreateNestedOneWithoutSessionsInput
    SessionLog?: SessionLogCreateNestedManyWithoutSessionInput
  }

  export type SessionUncheckedCreateInput = {
    id: string
    build_id?: string | null
    name?: string | null
    status?: string
    desired_capabilities: string
    session_capabilities: string
    node_id: string
    has_live_video: boolean
    video_recording_enabled?: boolean
    video_recording?: string | null
    startTime?: Date | string
    endTime?: Date | string | null
    failure_reason?: string | null
    is_profiling_available?: boolean
    device_info?: string | null
    device_udid: string
    device_platform: string
    device_version: string
    device_name?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    performance_trace?: string | null
    failure_category?: string | null
    ai_analysis?: string | null
    tags?: string | null
    trace_id?: string | null
    last_heartbeat_at?: Date | string | null
    heartbeat_pid?: number | null
    heartbeat_host?: string | null
    Log?: LogUncheckedCreateNestedManyWithoutSessionInput
    Profiling?: ProfilingUncheckedCreateNestedManyWithoutSessionInput
    SessionLog?: SessionLogUncheckedCreateNestedManyWithoutSessionInput
  }

  export type SessionUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    status?: StringFieldUpdateOperationsInput | string
    desired_capabilities?: StringFieldUpdateOperationsInput | string
    session_capabilities?: StringFieldUpdateOperationsInput | string
    node_id?: StringFieldUpdateOperationsInput | string
    has_live_video?: BoolFieldUpdateOperationsInput | boolean
    video_recording_enabled?: BoolFieldUpdateOperationsInput | boolean
    video_recording?: NullableStringFieldUpdateOperationsInput | string | null
    startTime?: DateTimeFieldUpdateOperationsInput | Date | string
    endTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    failure_reason?: NullableStringFieldUpdateOperationsInput | string | null
    is_profiling_available?: BoolFieldUpdateOperationsInput | boolean
    device_info?: NullableStringFieldUpdateOperationsInput | string | null
    device_udid?: StringFieldUpdateOperationsInput | string
    device_platform?: StringFieldUpdateOperationsInput | string
    device_version?: StringFieldUpdateOperationsInput | string
    device_name?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    performance_trace?: NullableStringFieldUpdateOperationsInput | string | null
    failure_category?: NullableStringFieldUpdateOperationsInput | string | null
    ai_analysis?: NullableStringFieldUpdateOperationsInput | string | null
    tags?: NullableStringFieldUpdateOperationsInput | string | null
    trace_id?: NullableStringFieldUpdateOperationsInput | string | null
    last_heartbeat_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    heartbeat_pid?: NullableIntFieldUpdateOperationsInput | number | null
    heartbeat_host?: NullableStringFieldUpdateOperationsInput | string | null
    Log?: LogUpdateManyWithoutSessionNestedInput
    Profiling?: ProfilingUpdateManyWithoutSessionNestedInput
    build?: BuildUpdateOneWithoutSessionsNestedInput
    SessionLog?: SessionLogUpdateManyWithoutSessionNestedInput
  }

  export type SessionUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    build_id?: NullableStringFieldUpdateOperationsInput | string | null
    name?: NullableStringFieldUpdateOperationsInput | string | null
    status?: StringFieldUpdateOperationsInput | string
    desired_capabilities?: StringFieldUpdateOperationsInput | string
    session_capabilities?: StringFieldUpdateOperationsInput | string
    node_id?: StringFieldUpdateOperationsInput | string
    has_live_video?: BoolFieldUpdateOperationsInput | boolean
    video_recording_enabled?: BoolFieldUpdateOperationsInput | boolean
    video_recording?: NullableStringFieldUpdateOperationsInput | string | null
    startTime?: DateTimeFieldUpdateOperationsInput | Date | string
    endTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    failure_reason?: NullableStringFieldUpdateOperationsInput | string | null
    is_profiling_available?: BoolFieldUpdateOperationsInput | boolean
    device_info?: NullableStringFieldUpdateOperationsInput | string | null
    device_udid?: StringFieldUpdateOperationsInput | string
    device_platform?: StringFieldUpdateOperationsInput | string
    device_version?: StringFieldUpdateOperationsInput | string
    device_name?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    performance_trace?: NullableStringFieldUpdateOperationsInput | string | null
    failure_category?: NullableStringFieldUpdateOperationsInput | string | null
    ai_analysis?: NullableStringFieldUpdateOperationsInput | string | null
    tags?: NullableStringFieldUpdateOperationsInput | string | null
    trace_id?: NullableStringFieldUpdateOperationsInput | string | null
    last_heartbeat_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    heartbeat_pid?: NullableIntFieldUpdateOperationsInput | number | null
    heartbeat_host?: NullableStringFieldUpdateOperationsInput | string | null
    Log?: LogUncheckedUpdateManyWithoutSessionNestedInput
    Profiling?: ProfilingUncheckedUpdateManyWithoutSessionNestedInput
    SessionLog?: SessionLogUncheckedUpdateManyWithoutSessionNestedInput
  }

  export type SessionCreateManyInput = {
    id: string
    build_id?: string | null
    name?: string | null
    status?: string
    desired_capabilities: string
    session_capabilities: string
    node_id: string
    has_live_video: boolean
    video_recording_enabled?: boolean
    video_recording?: string | null
    startTime?: Date | string
    endTime?: Date | string | null
    failure_reason?: string | null
    is_profiling_available?: boolean
    device_info?: string | null
    device_udid: string
    device_platform: string
    device_version: string
    device_name?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    performance_trace?: string | null
    failure_category?: string | null
    ai_analysis?: string | null
    tags?: string | null
    trace_id?: string | null
    last_heartbeat_at?: Date | string | null
    heartbeat_pid?: number | null
    heartbeat_host?: string | null
  }

  export type SessionUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    status?: StringFieldUpdateOperationsInput | string
    desired_capabilities?: StringFieldUpdateOperationsInput | string
    session_capabilities?: StringFieldUpdateOperationsInput | string
    node_id?: StringFieldUpdateOperationsInput | string
    has_live_video?: BoolFieldUpdateOperationsInput | boolean
    video_recording_enabled?: BoolFieldUpdateOperationsInput | boolean
    video_recording?: NullableStringFieldUpdateOperationsInput | string | null
    startTime?: DateTimeFieldUpdateOperationsInput | Date | string
    endTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    failure_reason?: NullableStringFieldUpdateOperationsInput | string | null
    is_profiling_available?: BoolFieldUpdateOperationsInput | boolean
    device_info?: NullableStringFieldUpdateOperationsInput | string | null
    device_udid?: StringFieldUpdateOperationsInput | string
    device_platform?: StringFieldUpdateOperationsInput | string
    device_version?: StringFieldUpdateOperationsInput | string
    device_name?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    performance_trace?: NullableStringFieldUpdateOperationsInput | string | null
    failure_category?: NullableStringFieldUpdateOperationsInput | string | null
    ai_analysis?: NullableStringFieldUpdateOperationsInput | string | null
    tags?: NullableStringFieldUpdateOperationsInput | string | null
    trace_id?: NullableStringFieldUpdateOperationsInput | string | null
    last_heartbeat_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    heartbeat_pid?: NullableIntFieldUpdateOperationsInput | number | null
    heartbeat_host?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type SessionUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    build_id?: NullableStringFieldUpdateOperationsInput | string | null
    name?: NullableStringFieldUpdateOperationsInput | string | null
    status?: StringFieldUpdateOperationsInput | string
    desired_capabilities?: StringFieldUpdateOperationsInput | string
    session_capabilities?: StringFieldUpdateOperationsInput | string
    node_id?: StringFieldUpdateOperationsInput | string
    has_live_video?: BoolFieldUpdateOperationsInput | boolean
    video_recording_enabled?: BoolFieldUpdateOperationsInput | boolean
    video_recording?: NullableStringFieldUpdateOperationsInput | string | null
    startTime?: DateTimeFieldUpdateOperationsInput | Date | string
    endTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    failure_reason?: NullableStringFieldUpdateOperationsInput | string | null
    is_profiling_available?: BoolFieldUpdateOperationsInput | boolean
    device_info?: NullableStringFieldUpdateOperationsInput | string | null
    device_udid?: StringFieldUpdateOperationsInput | string
    device_platform?: StringFieldUpdateOperationsInput | string
    device_version?: StringFieldUpdateOperationsInput | string
    device_name?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    performance_trace?: NullableStringFieldUpdateOperationsInput | string | null
    failure_category?: NullableStringFieldUpdateOperationsInput | string | null
    ai_analysis?: NullableStringFieldUpdateOperationsInput | string | null
    tags?: NullableStringFieldUpdateOperationsInput | string | null
    trace_id?: NullableStringFieldUpdateOperationsInput | string | null
    last_heartbeat_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    heartbeat_pid?: NullableIntFieldUpdateOperationsInput | number | null
    heartbeat_host?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type SessionLogCreateInput = {
    id?: string
    command_name?: string | null
    url: string
    method: string
    title: string
    subtitle?: string | null
    body?: string | null
    response: string
    screenshot?: string | null
    is_success?: boolean | null
    is_error?: boolean
    is_healed?: boolean
    original_selector?: string | null
    healed_selector?: string | null
    healing_confidence?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
    duration?: number | null
    span_id?: string | null
    trace_id?: string | null
    session: SessionCreateNestedOneWithoutSessionLogInput
  }

  export type SessionLogUncheckedCreateInput = {
    id?: string
    session_id: string
    command_name?: string | null
    url: string
    method: string
    title: string
    subtitle?: string | null
    body?: string | null
    response: string
    screenshot?: string | null
    is_success?: boolean | null
    is_error?: boolean
    is_healed?: boolean
    original_selector?: string | null
    healed_selector?: string | null
    healing_confidence?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
    duration?: number | null
    span_id?: string | null
    trace_id?: string | null
  }

  export type SessionLogUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    command_name?: NullableStringFieldUpdateOperationsInput | string | null
    url?: StringFieldUpdateOperationsInput | string
    method?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    subtitle?: NullableStringFieldUpdateOperationsInput | string | null
    body?: NullableStringFieldUpdateOperationsInput | string | null
    response?: StringFieldUpdateOperationsInput | string
    screenshot?: NullableStringFieldUpdateOperationsInput | string | null
    is_success?: NullableBoolFieldUpdateOperationsInput | boolean | null
    is_error?: BoolFieldUpdateOperationsInput | boolean
    is_healed?: BoolFieldUpdateOperationsInput | boolean
    original_selector?: NullableStringFieldUpdateOperationsInput | string | null
    healed_selector?: NullableStringFieldUpdateOperationsInput | string | null
    healing_confidence?: NullableFloatFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    span_id?: NullableStringFieldUpdateOperationsInput | string | null
    trace_id?: NullableStringFieldUpdateOperationsInput | string | null
    session?: SessionUpdateOneRequiredWithoutSessionLogNestedInput
  }

  export type SessionLogUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    session_id?: StringFieldUpdateOperationsInput | string
    command_name?: NullableStringFieldUpdateOperationsInput | string | null
    url?: StringFieldUpdateOperationsInput | string
    method?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    subtitle?: NullableStringFieldUpdateOperationsInput | string | null
    body?: NullableStringFieldUpdateOperationsInput | string | null
    response?: StringFieldUpdateOperationsInput | string
    screenshot?: NullableStringFieldUpdateOperationsInput | string | null
    is_success?: NullableBoolFieldUpdateOperationsInput | boolean | null
    is_error?: BoolFieldUpdateOperationsInput | boolean
    is_healed?: BoolFieldUpdateOperationsInput | boolean
    original_selector?: NullableStringFieldUpdateOperationsInput | string | null
    healed_selector?: NullableStringFieldUpdateOperationsInput | string | null
    healing_confidence?: NullableFloatFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    span_id?: NullableStringFieldUpdateOperationsInput | string | null
    trace_id?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type SessionLogCreateManyInput = {
    id?: string
    session_id: string
    command_name?: string | null
    url: string
    method: string
    title: string
    subtitle?: string | null
    body?: string | null
    response: string
    screenshot?: string | null
    is_success?: boolean | null
    is_error?: boolean
    is_healed?: boolean
    original_selector?: string | null
    healed_selector?: string | null
    healing_confidence?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
    duration?: number | null
    span_id?: string | null
    trace_id?: string | null
  }

  export type SessionLogUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    command_name?: NullableStringFieldUpdateOperationsInput | string | null
    url?: StringFieldUpdateOperationsInput | string
    method?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    subtitle?: NullableStringFieldUpdateOperationsInput | string | null
    body?: NullableStringFieldUpdateOperationsInput | string | null
    response?: StringFieldUpdateOperationsInput | string
    screenshot?: NullableStringFieldUpdateOperationsInput | string | null
    is_success?: NullableBoolFieldUpdateOperationsInput | boolean | null
    is_error?: BoolFieldUpdateOperationsInput | boolean
    is_healed?: BoolFieldUpdateOperationsInput | boolean
    original_selector?: NullableStringFieldUpdateOperationsInput | string | null
    healed_selector?: NullableStringFieldUpdateOperationsInput | string | null
    healing_confidence?: NullableFloatFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    span_id?: NullableStringFieldUpdateOperationsInput | string | null
    trace_id?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type SessionLogUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    session_id?: StringFieldUpdateOperationsInput | string
    command_name?: NullableStringFieldUpdateOperationsInput | string | null
    url?: StringFieldUpdateOperationsInput | string
    method?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    subtitle?: NullableStringFieldUpdateOperationsInput | string | null
    body?: NullableStringFieldUpdateOperationsInput | string | null
    response?: StringFieldUpdateOperationsInput | string
    screenshot?: NullableStringFieldUpdateOperationsInput | string | null
    is_success?: NullableBoolFieldUpdateOperationsInput | boolean | null
    is_error?: BoolFieldUpdateOperationsInput | boolean
    is_healed?: BoolFieldUpdateOperationsInput | boolean
    original_selector?: NullableStringFieldUpdateOperationsInput | string | null
    healed_selector?: NullableStringFieldUpdateOperationsInput | string | null
    healing_confidence?: NullableFloatFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    span_id?: NullableStringFieldUpdateOperationsInput | string | null
    trace_id?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type LogCreateInput = {
    id?: string
    log_type: string
    message: string
    timestamp?: Date | string
    createdAt?: Date | string
    updatedAt?: Date | string
    session: SessionCreateNestedOneWithoutLogInput
  }

  export type LogUncheckedCreateInput = {
    id?: string
    session_id: string
    log_type: string
    message: string
    timestamp?: Date | string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type LogUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    log_type?: StringFieldUpdateOperationsInput | string
    message?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    session?: SessionUpdateOneRequiredWithoutLogNestedInput
  }

  export type LogUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    session_id?: StringFieldUpdateOperationsInput | string
    log_type?: StringFieldUpdateOperationsInput | string
    message?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type LogCreateManyInput = {
    id?: string
    session_id: string
    log_type: string
    message: string
    timestamp?: Date | string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type LogUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    log_type?: StringFieldUpdateOperationsInput | string
    message?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type LogUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    session_id?: StringFieldUpdateOperationsInput | string
    log_type?: StringFieldUpdateOperationsInput | string
    message?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ProfilingCreateInput = {
    cpu?: string | null
    memory?: string | null
    total_cpu_used?: string | null
    total_memory_used?: string | null
    raw_cpu_log?: string | null
    raw_memory_log?: string | null
    timestamp: Date | string
    createdAt?: Date | string
    updatedAt?: Date | string
    session: SessionCreateNestedOneWithoutProfilingInput
  }

  export type ProfilingUncheckedCreateInput = {
    id?: number
    session_id: string
    cpu?: string | null
    memory?: string | null
    total_cpu_used?: string | null
    total_memory_used?: string | null
    raw_cpu_log?: string | null
    raw_memory_log?: string | null
    timestamp: Date | string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type ProfilingUpdateInput = {
    cpu?: NullableStringFieldUpdateOperationsInput | string | null
    memory?: NullableStringFieldUpdateOperationsInput | string | null
    total_cpu_used?: NullableStringFieldUpdateOperationsInput | string | null
    total_memory_used?: NullableStringFieldUpdateOperationsInput | string | null
    raw_cpu_log?: NullableStringFieldUpdateOperationsInput | string | null
    raw_memory_log?: NullableStringFieldUpdateOperationsInput | string | null
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    session?: SessionUpdateOneRequiredWithoutProfilingNestedInput
  }

  export type ProfilingUncheckedUpdateInput = {
    id?: IntFieldUpdateOperationsInput | number
    session_id?: StringFieldUpdateOperationsInput | string
    cpu?: NullableStringFieldUpdateOperationsInput | string | null
    memory?: NullableStringFieldUpdateOperationsInput | string | null
    total_cpu_used?: NullableStringFieldUpdateOperationsInput | string | null
    total_memory_used?: NullableStringFieldUpdateOperationsInput | string | null
    raw_cpu_log?: NullableStringFieldUpdateOperationsInput | string | null
    raw_memory_log?: NullableStringFieldUpdateOperationsInput | string | null
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ProfilingCreateManyInput = {
    id?: number
    session_id: string
    cpu?: string | null
    memory?: string | null
    total_cpu_used?: string | null
    total_memory_used?: string | null
    raw_cpu_log?: string | null
    raw_memory_log?: string | null
    timestamp: Date | string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type ProfilingUpdateManyMutationInput = {
    cpu?: NullableStringFieldUpdateOperationsInput | string | null
    memory?: NullableStringFieldUpdateOperationsInput | string | null
    total_cpu_used?: NullableStringFieldUpdateOperationsInput | string | null
    total_memory_used?: NullableStringFieldUpdateOperationsInput | string | null
    raw_cpu_log?: NullableStringFieldUpdateOperationsInput | string | null
    raw_memory_log?: NullableStringFieldUpdateOperationsInput | string | null
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ProfilingUncheckedUpdateManyInput = {
    id?: IntFieldUpdateOperationsInput | number
    session_id?: StringFieldUpdateOperationsInput | string
    cpu?: NullableStringFieldUpdateOperationsInput | string | null
    memory?: NullableStringFieldUpdateOperationsInput | string | null
    total_cpu_used?: NullableStringFieldUpdateOperationsInput | string | null
    total_memory_used?: NullableStringFieldUpdateOperationsInput | string | null
    raw_cpu_log?: NullableStringFieldUpdateOperationsInput | string | null
    raw_memory_log?: NullableStringFieldUpdateOperationsInput | string | null
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AppCreateInput = {
    id?: string
    name: string
    filename: string
    filepath: string
    mimetype: string
    size: number
    packageName?: string | null
    version?: string | null
    platform?: string | null
    md5?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type AppUncheckedCreateInput = {
    id?: string
    name: string
    filename: string
    filepath: string
    mimetype: string
    size: number
    packageName?: string | null
    version?: string | null
    platform?: string | null
    md5?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type AppUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    filename?: StringFieldUpdateOperationsInput | string
    filepath?: StringFieldUpdateOperationsInput | string
    mimetype?: StringFieldUpdateOperationsInput | string
    size?: IntFieldUpdateOperationsInput | number
    packageName?: NullableStringFieldUpdateOperationsInput | string | null
    version?: NullableStringFieldUpdateOperationsInput | string | null
    platform?: NullableStringFieldUpdateOperationsInput | string | null
    md5?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AppUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    filename?: StringFieldUpdateOperationsInput | string
    filepath?: StringFieldUpdateOperationsInput | string
    mimetype?: StringFieldUpdateOperationsInput | string
    size?: IntFieldUpdateOperationsInput | number
    packageName?: NullableStringFieldUpdateOperationsInput | string | null
    version?: NullableStringFieldUpdateOperationsInput | string | null
    platform?: NullableStringFieldUpdateOperationsInput | string | null
    md5?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AppCreateManyInput = {
    id?: string
    name: string
    filename: string
    filepath: string
    mimetype: string
    size: number
    packageName?: string | null
    version?: string | null
    platform?: string | null
    md5?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type AppUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    filename?: StringFieldUpdateOperationsInput | string
    filepath?: StringFieldUpdateOperationsInput | string
    mimetype?: StringFieldUpdateOperationsInput | string
    size?: IntFieldUpdateOperationsInput | number
    packageName?: NullableStringFieldUpdateOperationsInput | string | null
    version?: NullableStringFieldUpdateOperationsInput | string | null
    platform?: NullableStringFieldUpdateOperationsInput | string | null
    md5?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AppUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    filename?: StringFieldUpdateOperationsInput | string
    filepath?: StringFieldUpdateOperationsInput | string
    mimetype?: StringFieldUpdateOperationsInput | string
    size?: IntFieldUpdateOperationsInput | number
    packageName?: NullableStringFieldUpdateOperationsInput | string | null
    version?: NullableStringFieldUpdateOperationsInput | string | null
    platform?: NullableStringFieldUpdateOperationsInput | string | null
    md5?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type DeviceCreateInput = {
    udid: string
    host: string
    systemPort?: number | null
    proxyPort?: number | null
    proxyHost?: string | null
    wdaLocalPort?: number | null
    name?: string | null
    state?: string | null
    sdk?: string | null
    platform?: string | null
    deviceType?: string | null
    busy?: boolean | null
    userBlocked?: boolean | null
    realDevice?: boolean | null
    session_id?: string | null
    offline?: boolean | null
    mjpegServerPort?: number | null
    lastCmdExecutedAt?: number | null
    totalUtilizationTimeMilliSec?: number
    sessionStartTime?: number
    newCommandTimeout?: number | null
    cloud?: string | null
    derivedDataPath?: string | null
    chromeDriverPath?: string | null
    capability?: string | null
    adbRemoteHost?: string | null
    adbPort?: number | null
    nodeId?: string | null
    screenWidth?: string | null
    screenHeight?: string | null
    dashboard_link?: string | null
    total_session_count?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
    healthCheckError?: string | null
    healthStatus?: string | null
    lastHealthCheckAt?: number | null
    batteryLevel?: number | null
    reservationReason?: string | null
    reservedBy?: string | null
    reservedUntil?: number | null
    storageFree?: string | null
    tags?: string | null
    thermalStatus?: string | null
    sessionProgress?: string | null
    totalHealedCount?: number | null
    ip?: string | null
    cpuArchitecture?: string | null
    owning_session_id?: string | null
    locked_at?: number | null
  }

  export type DeviceUncheckedCreateInput = {
    udid: string
    host: string
    systemPort?: number | null
    proxyPort?: number | null
    proxyHost?: string | null
    wdaLocalPort?: number | null
    name?: string | null
    state?: string | null
    sdk?: string | null
    platform?: string | null
    deviceType?: string | null
    busy?: boolean | null
    userBlocked?: boolean | null
    realDevice?: boolean | null
    session_id?: string | null
    offline?: boolean | null
    mjpegServerPort?: number | null
    lastCmdExecutedAt?: number | null
    totalUtilizationTimeMilliSec?: number
    sessionStartTime?: number
    newCommandTimeout?: number | null
    cloud?: string | null
    derivedDataPath?: string | null
    chromeDriverPath?: string | null
    capability?: string | null
    adbRemoteHost?: string | null
    adbPort?: number | null
    nodeId?: string | null
    screenWidth?: string | null
    screenHeight?: string | null
    dashboard_link?: string | null
    total_session_count?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
    healthCheckError?: string | null
    healthStatus?: string | null
    lastHealthCheckAt?: number | null
    batteryLevel?: number | null
    reservationReason?: string | null
    reservedBy?: string | null
    reservedUntil?: number | null
    storageFree?: string | null
    tags?: string | null
    thermalStatus?: string | null
    sessionProgress?: string | null
    totalHealedCount?: number | null
    ip?: string | null
    cpuArchitecture?: string | null
    owning_session_id?: string | null
    locked_at?: number | null
  }

  export type DeviceUpdateInput = {
    udid?: StringFieldUpdateOperationsInput | string
    host?: StringFieldUpdateOperationsInput | string
    systemPort?: NullableIntFieldUpdateOperationsInput | number | null
    proxyPort?: NullableIntFieldUpdateOperationsInput | number | null
    proxyHost?: NullableStringFieldUpdateOperationsInput | string | null
    wdaLocalPort?: NullableIntFieldUpdateOperationsInput | number | null
    name?: NullableStringFieldUpdateOperationsInput | string | null
    state?: NullableStringFieldUpdateOperationsInput | string | null
    sdk?: NullableStringFieldUpdateOperationsInput | string | null
    platform?: NullableStringFieldUpdateOperationsInput | string | null
    deviceType?: NullableStringFieldUpdateOperationsInput | string | null
    busy?: NullableBoolFieldUpdateOperationsInput | boolean | null
    userBlocked?: NullableBoolFieldUpdateOperationsInput | boolean | null
    realDevice?: NullableBoolFieldUpdateOperationsInput | boolean | null
    session_id?: NullableStringFieldUpdateOperationsInput | string | null
    offline?: NullableBoolFieldUpdateOperationsInput | boolean | null
    mjpegServerPort?: NullableIntFieldUpdateOperationsInput | number | null
    lastCmdExecutedAt?: NullableFloatFieldUpdateOperationsInput | number | null
    totalUtilizationTimeMilliSec?: FloatFieldUpdateOperationsInput | number
    sessionStartTime?: FloatFieldUpdateOperationsInput | number
    newCommandTimeout?: NullableIntFieldUpdateOperationsInput | number | null
    cloud?: NullableStringFieldUpdateOperationsInput | string | null
    derivedDataPath?: NullableStringFieldUpdateOperationsInput | string | null
    chromeDriverPath?: NullableStringFieldUpdateOperationsInput | string | null
    capability?: NullableStringFieldUpdateOperationsInput | string | null
    adbRemoteHost?: NullableStringFieldUpdateOperationsInput | string | null
    adbPort?: NullableIntFieldUpdateOperationsInput | number | null
    nodeId?: NullableStringFieldUpdateOperationsInput | string | null
    screenWidth?: NullableStringFieldUpdateOperationsInput | string | null
    screenHeight?: NullableStringFieldUpdateOperationsInput | string | null
    dashboard_link?: NullableStringFieldUpdateOperationsInput | string | null
    total_session_count?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    healthCheckError?: NullableStringFieldUpdateOperationsInput | string | null
    healthStatus?: NullableStringFieldUpdateOperationsInput | string | null
    lastHealthCheckAt?: NullableFloatFieldUpdateOperationsInput | number | null
    batteryLevel?: NullableIntFieldUpdateOperationsInput | number | null
    reservationReason?: NullableStringFieldUpdateOperationsInput | string | null
    reservedBy?: NullableStringFieldUpdateOperationsInput | string | null
    reservedUntil?: NullableFloatFieldUpdateOperationsInput | number | null
    storageFree?: NullableStringFieldUpdateOperationsInput | string | null
    tags?: NullableStringFieldUpdateOperationsInput | string | null
    thermalStatus?: NullableStringFieldUpdateOperationsInput | string | null
    sessionProgress?: NullableStringFieldUpdateOperationsInput | string | null
    totalHealedCount?: NullableIntFieldUpdateOperationsInput | number | null
    ip?: NullableStringFieldUpdateOperationsInput | string | null
    cpuArchitecture?: NullableStringFieldUpdateOperationsInput | string | null
    owning_session_id?: NullableStringFieldUpdateOperationsInput | string | null
    locked_at?: NullableFloatFieldUpdateOperationsInput | number | null
  }

  export type DeviceUncheckedUpdateInput = {
    udid?: StringFieldUpdateOperationsInput | string
    host?: StringFieldUpdateOperationsInput | string
    systemPort?: NullableIntFieldUpdateOperationsInput | number | null
    proxyPort?: NullableIntFieldUpdateOperationsInput | number | null
    proxyHost?: NullableStringFieldUpdateOperationsInput | string | null
    wdaLocalPort?: NullableIntFieldUpdateOperationsInput | number | null
    name?: NullableStringFieldUpdateOperationsInput | string | null
    state?: NullableStringFieldUpdateOperationsInput | string | null
    sdk?: NullableStringFieldUpdateOperationsInput | string | null
    platform?: NullableStringFieldUpdateOperationsInput | string | null
    deviceType?: NullableStringFieldUpdateOperationsInput | string | null
    busy?: NullableBoolFieldUpdateOperationsInput | boolean | null
    userBlocked?: NullableBoolFieldUpdateOperationsInput | boolean | null
    realDevice?: NullableBoolFieldUpdateOperationsInput | boolean | null
    session_id?: NullableStringFieldUpdateOperationsInput | string | null
    offline?: NullableBoolFieldUpdateOperationsInput | boolean | null
    mjpegServerPort?: NullableIntFieldUpdateOperationsInput | number | null
    lastCmdExecutedAt?: NullableFloatFieldUpdateOperationsInput | number | null
    totalUtilizationTimeMilliSec?: FloatFieldUpdateOperationsInput | number
    sessionStartTime?: FloatFieldUpdateOperationsInput | number
    newCommandTimeout?: NullableIntFieldUpdateOperationsInput | number | null
    cloud?: NullableStringFieldUpdateOperationsInput | string | null
    derivedDataPath?: NullableStringFieldUpdateOperationsInput | string | null
    chromeDriverPath?: NullableStringFieldUpdateOperationsInput | string | null
    capability?: NullableStringFieldUpdateOperationsInput | string | null
    adbRemoteHost?: NullableStringFieldUpdateOperationsInput | string | null
    adbPort?: NullableIntFieldUpdateOperationsInput | number | null
    nodeId?: NullableStringFieldUpdateOperationsInput | string | null
    screenWidth?: NullableStringFieldUpdateOperationsInput | string | null
    screenHeight?: NullableStringFieldUpdateOperationsInput | string | null
    dashboard_link?: NullableStringFieldUpdateOperationsInput | string | null
    total_session_count?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    healthCheckError?: NullableStringFieldUpdateOperationsInput | string | null
    healthStatus?: NullableStringFieldUpdateOperationsInput | string | null
    lastHealthCheckAt?: NullableFloatFieldUpdateOperationsInput | number | null
    batteryLevel?: NullableIntFieldUpdateOperationsInput | number | null
    reservationReason?: NullableStringFieldUpdateOperationsInput | string | null
    reservedBy?: NullableStringFieldUpdateOperationsInput | string | null
    reservedUntil?: NullableFloatFieldUpdateOperationsInput | number | null
    storageFree?: NullableStringFieldUpdateOperationsInput | string | null
    tags?: NullableStringFieldUpdateOperationsInput | string | null
    thermalStatus?: NullableStringFieldUpdateOperationsInput | string | null
    sessionProgress?: NullableStringFieldUpdateOperationsInput | string | null
    totalHealedCount?: NullableIntFieldUpdateOperationsInput | number | null
    ip?: NullableStringFieldUpdateOperationsInput | string | null
    cpuArchitecture?: NullableStringFieldUpdateOperationsInput | string | null
    owning_session_id?: NullableStringFieldUpdateOperationsInput | string | null
    locked_at?: NullableFloatFieldUpdateOperationsInput | number | null
  }

  export type DeviceCreateManyInput = {
    udid: string
    host: string
    systemPort?: number | null
    proxyPort?: number | null
    proxyHost?: string | null
    wdaLocalPort?: number | null
    name?: string | null
    state?: string | null
    sdk?: string | null
    platform?: string | null
    deviceType?: string | null
    busy?: boolean | null
    userBlocked?: boolean | null
    realDevice?: boolean | null
    session_id?: string | null
    offline?: boolean | null
    mjpegServerPort?: number | null
    lastCmdExecutedAt?: number | null
    totalUtilizationTimeMilliSec?: number
    sessionStartTime?: number
    newCommandTimeout?: number | null
    cloud?: string | null
    derivedDataPath?: string | null
    chromeDriverPath?: string | null
    capability?: string | null
    adbRemoteHost?: string | null
    adbPort?: number | null
    nodeId?: string | null
    screenWidth?: string | null
    screenHeight?: string | null
    dashboard_link?: string | null
    total_session_count?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
    healthCheckError?: string | null
    healthStatus?: string | null
    lastHealthCheckAt?: number | null
    batteryLevel?: number | null
    reservationReason?: string | null
    reservedBy?: string | null
    reservedUntil?: number | null
    storageFree?: string | null
    tags?: string | null
    thermalStatus?: string | null
    sessionProgress?: string | null
    totalHealedCount?: number | null
    ip?: string | null
    cpuArchitecture?: string | null
    owning_session_id?: string | null
    locked_at?: number | null
  }

  export type DeviceUpdateManyMutationInput = {
    udid?: StringFieldUpdateOperationsInput | string
    host?: StringFieldUpdateOperationsInput | string
    systemPort?: NullableIntFieldUpdateOperationsInput | number | null
    proxyPort?: NullableIntFieldUpdateOperationsInput | number | null
    proxyHost?: NullableStringFieldUpdateOperationsInput | string | null
    wdaLocalPort?: NullableIntFieldUpdateOperationsInput | number | null
    name?: NullableStringFieldUpdateOperationsInput | string | null
    state?: NullableStringFieldUpdateOperationsInput | string | null
    sdk?: NullableStringFieldUpdateOperationsInput | string | null
    platform?: NullableStringFieldUpdateOperationsInput | string | null
    deviceType?: NullableStringFieldUpdateOperationsInput | string | null
    busy?: NullableBoolFieldUpdateOperationsInput | boolean | null
    userBlocked?: NullableBoolFieldUpdateOperationsInput | boolean | null
    realDevice?: NullableBoolFieldUpdateOperationsInput | boolean | null
    session_id?: NullableStringFieldUpdateOperationsInput | string | null
    offline?: NullableBoolFieldUpdateOperationsInput | boolean | null
    mjpegServerPort?: NullableIntFieldUpdateOperationsInput | number | null
    lastCmdExecutedAt?: NullableFloatFieldUpdateOperationsInput | number | null
    totalUtilizationTimeMilliSec?: FloatFieldUpdateOperationsInput | number
    sessionStartTime?: FloatFieldUpdateOperationsInput | number
    newCommandTimeout?: NullableIntFieldUpdateOperationsInput | number | null
    cloud?: NullableStringFieldUpdateOperationsInput | string | null
    derivedDataPath?: NullableStringFieldUpdateOperationsInput | string | null
    chromeDriverPath?: NullableStringFieldUpdateOperationsInput | string | null
    capability?: NullableStringFieldUpdateOperationsInput | string | null
    adbRemoteHost?: NullableStringFieldUpdateOperationsInput | string | null
    adbPort?: NullableIntFieldUpdateOperationsInput | number | null
    nodeId?: NullableStringFieldUpdateOperationsInput | string | null
    screenWidth?: NullableStringFieldUpdateOperationsInput | string | null
    screenHeight?: NullableStringFieldUpdateOperationsInput | string | null
    dashboard_link?: NullableStringFieldUpdateOperationsInput | string | null
    total_session_count?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    healthCheckError?: NullableStringFieldUpdateOperationsInput | string | null
    healthStatus?: NullableStringFieldUpdateOperationsInput | string | null
    lastHealthCheckAt?: NullableFloatFieldUpdateOperationsInput | number | null
    batteryLevel?: NullableIntFieldUpdateOperationsInput | number | null
    reservationReason?: NullableStringFieldUpdateOperationsInput | string | null
    reservedBy?: NullableStringFieldUpdateOperationsInput | string | null
    reservedUntil?: NullableFloatFieldUpdateOperationsInput | number | null
    storageFree?: NullableStringFieldUpdateOperationsInput | string | null
    tags?: NullableStringFieldUpdateOperationsInput | string | null
    thermalStatus?: NullableStringFieldUpdateOperationsInput | string | null
    sessionProgress?: NullableStringFieldUpdateOperationsInput | string | null
    totalHealedCount?: NullableIntFieldUpdateOperationsInput | number | null
    ip?: NullableStringFieldUpdateOperationsInput | string | null
    cpuArchitecture?: NullableStringFieldUpdateOperationsInput | string | null
    owning_session_id?: NullableStringFieldUpdateOperationsInput | string | null
    locked_at?: NullableFloatFieldUpdateOperationsInput | number | null
  }

  export type DeviceUncheckedUpdateManyInput = {
    udid?: StringFieldUpdateOperationsInput | string
    host?: StringFieldUpdateOperationsInput | string
    systemPort?: NullableIntFieldUpdateOperationsInput | number | null
    proxyPort?: NullableIntFieldUpdateOperationsInput | number | null
    proxyHost?: NullableStringFieldUpdateOperationsInput | string | null
    wdaLocalPort?: NullableIntFieldUpdateOperationsInput | number | null
    name?: NullableStringFieldUpdateOperationsInput | string | null
    state?: NullableStringFieldUpdateOperationsInput | string | null
    sdk?: NullableStringFieldUpdateOperationsInput | string | null
    platform?: NullableStringFieldUpdateOperationsInput | string | null
    deviceType?: NullableStringFieldUpdateOperationsInput | string | null
    busy?: NullableBoolFieldUpdateOperationsInput | boolean | null
    userBlocked?: NullableBoolFieldUpdateOperationsInput | boolean | null
    realDevice?: NullableBoolFieldUpdateOperationsInput | boolean | null
    session_id?: NullableStringFieldUpdateOperationsInput | string | null
    offline?: NullableBoolFieldUpdateOperationsInput | boolean | null
    mjpegServerPort?: NullableIntFieldUpdateOperationsInput | number | null
    lastCmdExecutedAt?: NullableFloatFieldUpdateOperationsInput | number | null
    totalUtilizationTimeMilliSec?: FloatFieldUpdateOperationsInput | number
    sessionStartTime?: FloatFieldUpdateOperationsInput | number
    newCommandTimeout?: NullableIntFieldUpdateOperationsInput | number | null
    cloud?: NullableStringFieldUpdateOperationsInput | string | null
    derivedDataPath?: NullableStringFieldUpdateOperationsInput | string | null
    chromeDriverPath?: NullableStringFieldUpdateOperationsInput | string | null
    capability?: NullableStringFieldUpdateOperationsInput | string | null
    adbRemoteHost?: NullableStringFieldUpdateOperationsInput | string | null
    adbPort?: NullableIntFieldUpdateOperationsInput | number | null
    nodeId?: NullableStringFieldUpdateOperationsInput | string | null
    screenWidth?: NullableStringFieldUpdateOperationsInput | string | null
    screenHeight?: NullableStringFieldUpdateOperationsInput | string | null
    dashboard_link?: NullableStringFieldUpdateOperationsInput | string | null
    total_session_count?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    healthCheckError?: NullableStringFieldUpdateOperationsInput | string | null
    healthStatus?: NullableStringFieldUpdateOperationsInput | string | null
    lastHealthCheckAt?: NullableFloatFieldUpdateOperationsInput | number | null
    batteryLevel?: NullableIntFieldUpdateOperationsInput | number | null
    reservationReason?: NullableStringFieldUpdateOperationsInput | string | null
    reservedBy?: NullableStringFieldUpdateOperationsInput | string | null
    reservedUntil?: NullableFloatFieldUpdateOperationsInput | number | null
    storageFree?: NullableStringFieldUpdateOperationsInput | string | null
    tags?: NullableStringFieldUpdateOperationsInput | string | null
    thermalStatus?: NullableStringFieldUpdateOperationsInput | string | null
    sessionProgress?: NullableStringFieldUpdateOperationsInput | string | null
    totalHealedCount?: NullableIntFieldUpdateOperationsInput | number | null
    ip?: NullableStringFieldUpdateOperationsInput | string | null
    cpuArchitecture?: NullableStringFieldUpdateOperationsInput | string | null
    owning_session_id?: NullableStringFieldUpdateOperationsInput | string | null
    locked_at?: NullableFloatFieldUpdateOperationsInput | number | null
  }

  export type PendingSessionCreateInput = {
    capability_id: string
    capability: string
    createdAt: number
  }

  export type PendingSessionUncheckedCreateInput = {
    id?: number
    capability_id: string
    capability: string
    createdAt: number
  }

  export type PendingSessionUpdateInput = {
    capability_id?: StringFieldUpdateOperationsInput | string
    capability?: StringFieldUpdateOperationsInput | string
    createdAt?: FloatFieldUpdateOperationsInput | number
  }

  export type PendingSessionUncheckedUpdateInput = {
    id?: IntFieldUpdateOperationsInput | number
    capability_id?: StringFieldUpdateOperationsInput | string
    capability?: StringFieldUpdateOperationsInput | string
    createdAt?: FloatFieldUpdateOperationsInput | number
  }

  export type PendingSessionCreateManyInput = {
    id?: number
    capability_id: string
    capability: string
    createdAt: number
  }

  export type PendingSessionUpdateManyMutationInput = {
    capability_id?: StringFieldUpdateOperationsInput | string
    capability?: StringFieldUpdateOperationsInput | string
    createdAt?: FloatFieldUpdateOperationsInput | number
  }

  export type PendingSessionUncheckedUpdateManyInput = {
    id?: IntFieldUpdateOperationsInput | number
    capability_id?: StringFieldUpdateOperationsInput | string
    capability?: StringFieldUpdateOperationsInput | string
    createdAt?: FloatFieldUpdateOperationsInput | number
  }

  export type CLIArgsCreateInput = {
    args: string
    createdAt?: Date | string
  }

  export type CLIArgsUncheckedCreateInput = {
    id?: number
    args: string
    createdAt?: Date | string
  }

  export type CLIArgsUpdateInput = {
    args?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type CLIArgsUncheckedUpdateInput = {
    id?: IntFieldUpdateOperationsInput | number
    args?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type CLIArgsCreateManyInput = {
    id?: number
    args: string
    createdAt?: Date | string
  }

  export type CLIArgsUpdateManyMutationInput = {
    args?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type CLIArgsUncheckedUpdateManyInput = {
    id?: IntFieldUpdateOperationsInput | number
    args?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WebhookConfigCreateInput = {
    id?: string
    url: string
    type?: string
    events: string
    active?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    payloadTemplate?: string | null
  }

  export type WebhookConfigUncheckedCreateInput = {
    id?: string
    url: string
    type?: string
    events: string
    active?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    payloadTemplate?: string | null
  }

  export type WebhookConfigUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    url?: StringFieldUpdateOperationsInput | string
    type?: StringFieldUpdateOperationsInput | string
    events?: StringFieldUpdateOperationsInput | string
    active?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    payloadTemplate?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type WebhookConfigUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    url?: StringFieldUpdateOperationsInput | string
    type?: StringFieldUpdateOperationsInput | string
    events?: StringFieldUpdateOperationsInput | string
    active?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    payloadTemplate?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type WebhookConfigCreateManyInput = {
    id?: string
    url: string
    type?: string
    events: string
    active?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    payloadTemplate?: string | null
  }

  export type WebhookConfigUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    url?: StringFieldUpdateOperationsInput | string
    type?: StringFieldUpdateOperationsInput | string
    events?: StringFieldUpdateOperationsInput | string
    active?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    payloadTemplate?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type WebhookConfigUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    url?: StringFieldUpdateOperationsInput | string
    type?: StringFieldUpdateOperationsInput | string
    events?: StringFieldUpdateOperationsInput | string
    active?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    payloadTemplate?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type WebConfigCreateInput = {
    id?: string
    name: string
    value: string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type WebConfigUncheckedCreateInput = {
    id?: string
    name: string
    value: string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type WebConfigUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    value?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WebConfigUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    value?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WebConfigCreateManyInput = {
    id?: string
    name: string
    value: string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type WebConfigUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    value?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type WebConfigUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    value?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type LocatorEtalonCreateInput = {
    id?: string
    selector: string
    strategy: string
    attributes: string
    nodeName: string
    lastSeen?: Date | string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type LocatorEtalonUncheckedCreateInput = {
    id?: string
    selector: string
    strategy: string
    attributes: string
    nodeName: string
    lastSeen?: Date | string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type LocatorEtalonUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    selector?: StringFieldUpdateOperationsInput | string
    strategy?: StringFieldUpdateOperationsInput | string
    attributes?: StringFieldUpdateOperationsInput | string
    nodeName?: StringFieldUpdateOperationsInput | string
    lastSeen?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type LocatorEtalonUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    selector?: StringFieldUpdateOperationsInput | string
    strategy?: StringFieldUpdateOperationsInput | string
    attributes?: StringFieldUpdateOperationsInput | string
    nodeName?: StringFieldUpdateOperationsInput | string
    lastSeen?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type LocatorEtalonCreateManyInput = {
    id?: string
    selector: string
    strategy: string
    attributes: string
    nodeName: string
    lastSeen?: Date | string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type LocatorEtalonUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    selector?: StringFieldUpdateOperationsInput | string
    strategy?: StringFieldUpdateOperationsInput | string
    attributes?: StringFieldUpdateOperationsInput | string
    nodeName?: StringFieldUpdateOperationsInput | string
    lastSeen?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type LocatorEtalonUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    selector?: StringFieldUpdateOperationsInput | string
    strategy?: StringFieldUpdateOperationsInput | string
    attributes?: StringFieldUpdateOperationsInput | string
    nodeName?: StringFieldUpdateOperationsInput | string
    lastSeen?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type StringFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[]
    notIn?: string[]
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringFilter<$PrismaModel> | string
  }

  export type StringNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | null
    notIn?: string[] | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringNullableFilter<$PrismaModel> | string | null
  }

  export type DateTimeFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[]
    notIn?: Date[] | string[]
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeFilter<$PrismaModel> | Date | string
  }

  export type SessionListRelationFilter = {
    every?: SessionWhereInput
    some?: SessionWhereInput
    none?: SessionWhereInput
  }

  export type SortOrderInput = {
    sort: SortOrder
    nulls?: NullsOrder
  }

  export type SessionOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type BuildCountOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type BuildMaxOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type BuildMinOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type StringWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[]
    notIn?: string[]
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }

  export type StringNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | null
    notIn?: string[] | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }

  export type DateTimeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[]
    notIn?: Date[] | string[]
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeWithAggregatesFilter<$PrismaModel> | Date | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedDateTimeFilter<$PrismaModel>
    _max?: NestedDateTimeFilter<$PrismaModel>
  }

  export type BoolFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolFilter<$PrismaModel> | boolean
  }

  export type DateTimeNullableFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | null
    notIn?: Date[] | string[] | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableFilter<$PrismaModel> | Date | string | null
  }

  export type IntNullableFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | null
    notIn?: number[] | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableFilter<$PrismaModel> | number | null
  }

  export type LogListRelationFilter = {
    every?: LogWhereInput
    some?: LogWhereInput
    none?: LogWhereInput
  }

  export type ProfilingListRelationFilter = {
    every?: ProfilingWhereInput
    some?: ProfilingWhereInput
    none?: ProfilingWhereInput
  }

  export type BuildNullableRelationFilter = {
    is?: BuildWhereInput | null
    isNot?: BuildWhereInput | null
  }

  export type SessionLogListRelationFilter = {
    every?: SessionLogWhereInput
    some?: SessionLogWhereInput
    none?: SessionLogWhereInput
  }

  export type LogOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type ProfilingOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type SessionLogOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type SessionCountOrderByAggregateInput = {
    id?: SortOrder
    build_id?: SortOrder
    name?: SortOrder
    status?: SortOrder
    desired_capabilities?: SortOrder
    session_capabilities?: SortOrder
    node_id?: SortOrder
    has_live_video?: SortOrder
    video_recording_enabled?: SortOrder
    video_recording?: SortOrder
    startTime?: SortOrder
    endTime?: SortOrder
    failure_reason?: SortOrder
    is_profiling_available?: SortOrder
    device_info?: SortOrder
    device_udid?: SortOrder
    device_platform?: SortOrder
    device_version?: SortOrder
    device_name?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    performance_trace?: SortOrder
    failure_category?: SortOrder
    ai_analysis?: SortOrder
    tags?: SortOrder
    trace_id?: SortOrder
    last_heartbeat_at?: SortOrder
    heartbeat_pid?: SortOrder
    heartbeat_host?: SortOrder
  }

  export type SessionAvgOrderByAggregateInput = {
    heartbeat_pid?: SortOrder
  }

  export type SessionMaxOrderByAggregateInput = {
    id?: SortOrder
    build_id?: SortOrder
    name?: SortOrder
    status?: SortOrder
    desired_capabilities?: SortOrder
    session_capabilities?: SortOrder
    node_id?: SortOrder
    has_live_video?: SortOrder
    video_recording_enabled?: SortOrder
    video_recording?: SortOrder
    startTime?: SortOrder
    endTime?: SortOrder
    failure_reason?: SortOrder
    is_profiling_available?: SortOrder
    device_info?: SortOrder
    device_udid?: SortOrder
    device_platform?: SortOrder
    device_version?: SortOrder
    device_name?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    performance_trace?: SortOrder
    failure_category?: SortOrder
    ai_analysis?: SortOrder
    tags?: SortOrder
    trace_id?: SortOrder
    last_heartbeat_at?: SortOrder
    heartbeat_pid?: SortOrder
    heartbeat_host?: SortOrder
  }

  export type SessionMinOrderByAggregateInput = {
    id?: SortOrder
    build_id?: SortOrder
    name?: SortOrder
    status?: SortOrder
    desired_capabilities?: SortOrder
    session_capabilities?: SortOrder
    node_id?: SortOrder
    has_live_video?: SortOrder
    video_recording_enabled?: SortOrder
    video_recording?: SortOrder
    startTime?: SortOrder
    endTime?: SortOrder
    failure_reason?: SortOrder
    is_profiling_available?: SortOrder
    device_info?: SortOrder
    device_udid?: SortOrder
    device_platform?: SortOrder
    device_version?: SortOrder
    device_name?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    performance_trace?: SortOrder
    failure_category?: SortOrder
    ai_analysis?: SortOrder
    tags?: SortOrder
    trace_id?: SortOrder
    last_heartbeat_at?: SortOrder
    heartbeat_pid?: SortOrder
    heartbeat_host?: SortOrder
  }

  export type SessionSumOrderByAggregateInput = {
    heartbeat_pid?: SortOrder
  }

  export type BoolWithAggregatesFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolWithAggregatesFilter<$PrismaModel> | boolean
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedBoolFilter<$PrismaModel>
    _max?: NestedBoolFilter<$PrismaModel>
  }

  export type DateTimeNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | null
    notIn?: Date[] | string[] | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableWithAggregatesFilter<$PrismaModel> | Date | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedDateTimeNullableFilter<$PrismaModel>
    _max?: NestedDateTimeNullableFilter<$PrismaModel>
  }

  export type IntNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | null
    notIn?: number[] | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableWithAggregatesFilter<$PrismaModel> | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedIntNullableFilter<$PrismaModel>
    _max?: NestedIntNullableFilter<$PrismaModel>
  }

  export type BoolNullableFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel> | null
    not?: NestedBoolNullableFilter<$PrismaModel> | boolean | null
  }

  export type FloatNullableFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel> | null
    in?: number[] | null
    notIn?: number[] | null
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatNullableFilter<$PrismaModel> | number | null
  }

  export type SessionRelationFilter = {
    is?: SessionWhereInput
    isNot?: SessionWhereInput
  }

  export type SessionLogCountOrderByAggregateInput = {
    id?: SortOrder
    session_id?: SortOrder
    command_name?: SortOrder
    url?: SortOrder
    method?: SortOrder
    title?: SortOrder
    subtitle?: SortOrder
    body?: SortOrder
    response?: SortOrder
    screenshot?: SortOrder
    is_success?: SortOrder
    is_error?: SortOrder
    is_healed?: SortOrder
    original_selector?: SortOrder
    healed_selector?: SortOrder
    healing_confidence?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    duration?: SortOrder
    span_id?: SortOrder
    trace_id?: SortOrder
  }

  export type SessionLogAvgOrderByAggregateInput = {
    healing_confidence?: SortOrder
    duration?: SortOrder
  }

  export type SessionLogMaxOrderByAggregateInput = {
    id?: SortOrder
    session_id?: SortOrder
    command_name?: SortOrder
    url?: SortOrder
    method?: SortOrder
    title?: SortOrder
    subtitle?: SortOrder
    body?: SortOrder
    response?: SortOrder
    screenshot?: SortOrder
    is_success?: SortOrder
    is_error?: SortOrder
    is_healed?: SortOrder
    original_selector?: SortOrder
    healed_selector?: SortOrder
    healing_confidence?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    duration?: SortOrder
    span_id?: SortOrder
    trace_id?: SortOrder
  }

  export type SessionLogMinOrderByAggregateInput = {
    id?: SortOrder
    session_id?: SortOrder
    command_name?: SortOrder
    url?: SortOrder
    method?: SortOrder
    title?: SortOrder
    subtitle?: SortOrder
    body?: SortOrder
    response?: SortOrder
    screenshot?: SortOrder
    is_success?: SortOrder
    is_error?: SortOrder
    is_healed?: SortOrder
    original_selector?: SortOrder
    healed_selector?: SortOrder
    healing_confidence?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    duration?: SortOrder
    span_id?: SortOrder
    trace_id?: SortOrder
  }

  export type SessionLogSumOrderByAggregateInput = {
    healing_confidence?: SortOrder
    duration?: SortOrder
  }

  export type BoolNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel> | null
    not?: NestedBoolNullableWithAggregatesFilter<$PrismaModel> | boolean | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedBoolNullableFilter<$PrismaModel>
    _max?: NestedBoolNullableFilter<$PrismaModel>
  }

  export type FloatNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel> | null
    in?: number[] | null
    notIn?: number[] | null
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatNullableWithAggregatesFilter<$PrismaModel> | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedFloatNullableFilter<$PrismaModel>
    _min?: NestedFloatNullableFilter<$PrismaModel>
    _max?: NestedFloatNullableFilter<$PrismaModel>
  }

  export type LogCountOrderByAggregateInput = {
    id?: SortOrder
    session_id?: SortOrder
    log_type?: SortOrder
    message?: SortOrder
    timestamp?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type LogMaxOrderByAggregateInput = {
    id?: SortOrder
    session_id?: SortOrder
    log_type?: SortOrder
    message?: SortOrder
    timestamp?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type LogMinOrderByAggregateInput = {
    id?: SortOrder
    session_id?: SortOrder
    log_type?: SortOrder
    message?: SortOrder
    timestamp?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type IntFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[]
    notIn?: number[]
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntFilter<$PrismaModel> | number
  }

  export type ProfilingCountOrderByAggregateInput = {
    id?: SortOrder
    session_id?: SortOrder
    cpu?: SortOrder
    memory?: SortOrder
    total_cpu_used?: SortOrder
    total_memory_used?: SortOrder
    raw_cpu_log?: SortOrder
    raw_memory_log?: SortOrder
    timestamp?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type ProfilingAvgOrderByAggregateInput = {
    id?: SortOrder
  }

  export type ProfilingMaxOrderByAggregateInput = {
    id?: SortOrder
    session_id?: SortOrder
    cpu?: SortOrder
    memory?: SortOrder
    total_cpu_used?: SortOrder
    total_memory_used?: SortOrder
    raw_cpu_log?: SortOrder
    raw_memory_log?: SortOrder
    timestamp?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type ProfilingMinOrderByAggregateInput = {
    id?: SortOrder
    session_id?: SortOrder
    cpu?: SortOrder
    memory?: SortOrder
    total_cpu_used?: SortOrder
    total_memory_used?: SortOrder
    raw_cpu_log?: SortOrder
    raw_memory_log?: SortOrder
    timestamp?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type ProfilingSumOrderByAggregateInput = {
    id?: SortOrder
  }

  export type IntWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[]
    notIn?: number[]
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedIntFilter<$PrismaModel>
    _min?: NestedIntFilter<$PrismaModel>
    _max?: NestedIntFilter<$PrismaModel>
  }

  export type AppCountOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    filename?: SortOrder
    filepath?: SortOrder
    mimetype?: SortOrder
    size?: SortOrder
    packageName?: SortOrder
    version?: SortOrder
    platform?: SortOrder
    md5?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type AppAvgOrderByAggregateInput = {
    size?: SortOrder
  }

  export type AppMaxOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    filename?: SortOrder
    filepath?: SortOrder
    mimetype?: SortOrder
    size?: SortOrder
    packageName?: SortOrder
    version?: SortOrder
    platform?: SortOrder
    md5?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type AppMinOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    filename?: SortOrder
    filepath?: SortOrder
    mimetype?: SortOrder
    size?: SortOrder
    packageName?: SortOrder
    version?: SortOrder
    platform?: SortOrder
    md5?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type AppSumOrderByAggregateInput = {
    size?: SortOrder
  }

  export type FloatFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[]
    notIn?: number[]
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatFilter<$PrismaModel> | number
  }

  export type DeviceUdidHostCompoundUniqueInput = {
    udid: string
    host: string
  }

  export type DeviceCountOrderByAggregateInput = {
    udid?: SortOrder
    host?: SortOrder
    systemPort?: SortOrder
    proxyPort?: SortOrder
    proxyHost?: SortOrder
    wdaLocalPort?: SortOrder
    name?: SortOrder
    state?: SortOrder
    sdk?: SortOrder
    platform?: SortOrder
    deviceType?: SortOrder
    busy?: SortOrder
    userBlocked?: SortOrder
    realDevice?: SortOrder
    session_id?: SortOrder
    offline?: SortOrder
    mjpegServerPort?: SortOrder
    lastCmdExecutedAt?: SortOrder
    totalUtilizationTimeMilliSec?: SortOrder
    sessionStartTime?: SortOrder
    newCommandTimeout?: SortOrder
    cloud?: SortOrder
    derivedDataPath?: SortOrder
    chromeDriverPath?: SortOrder
    capability?: SortOrder
    adbRemoteHost?: SortOrder
    adbPort?: SortOrder
    nodeId?: SortOrder
    screenWidth?: SortOrder
    screenHeight?: SortOrder
    dashboard_link?: SortOrder
    total_session_count?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    healthCheckError?: SortOrder
    healthStatus?: SortOrder
    lastHealthCheckAt?: SortOrder
    batteryLevel?: SortOrder
    reservationReason?: SortOrder
    reservedBy?: SortOrder
    reservedUntil?: SortOrder
    storageFree?: SortOrder
    tags?: SortOrder
    thermalStatus?: SortOrder
    sessionProgress?: SortOrder
    totalHealedCount?: SortOrder
    ip?: SortOrder
    cpuArchitecture?: SortOrder
    owning_session_id?: SortOrder
    locked_at?: SortOrder
  }

  export type DeviceAvgOrderByAggregateInput = {
    systemPort?: SortOrder
    proxyPort?: SortOrder
    wdaLocalPort?: SortOrder
    mjpegServerPort?: SortOrder
    lastCmdExecutedAt?: SortOrder
    totalUtilizationTimeMilliSec?: SortOrder
    sessionStartTime?: SortOrder
    newCommandTimeout?: SortOrder
    adbPort?: SortOrder
    total_session_count?: SortOrder
    lastHealthCheckAt?: SortOrder
    batteryLevel?: SortOrder
    reservedUntil?: SortOrder
    totalHealedCount?: SortOrder
    locked_at?: SortOrder
  }

  export type DeviceMaxOrderByAggregateInput = {
    udid?: SortOrder
    host?: SortOrder
    systemPort?: SortOrder
    proxyPort?: SortOrder
    proxyHost?: SortOrder
    wdaLocalPort?: SortOrder
    name?: SortOrder
    state?: SortOrder
    sdk?: SortOrder
    platform?: SortOrder
    deviceType?: SortOrder
    busy?: SortOrder
    userBlocked?: SortOrder
    realDevice?: SortOrder
    session_id?: SortOrder
    offline?: SortOrder
    mjpegServerPort?: SortOrder
    lastCmdExecutedAt?: SortOrder
    totalUtilizationTimeMilliSec?: SortOrder
    sessionStartTime?: SortOrder
    newCommandTimeout?: SortOrder
    cloud?: SortOrder
    derivedDataPath?: SortOrder
    chromeDriverPath?: SortOrder
    capability?: SortOrder
    adbRemoteHost?: SortOrder
    adbPort?: SortOrder
    nodeId?: SortOrder
    screenWidth?: SortOrder
    screenHeight?: SortOrder
    dashboard_link?: SortOrder
    total_session_count?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    healthCheckError?: SortOrder
    healthStatus?: SortOrder
    lastHealthCheckAt?: SortOrder
    batteryLevel?: SortOrder
    reservationReason?: SortOrder
    reservedBy?: SortOrder
    reservedUntil?: SortOrder
    storageFree?: SortOrder
    tags?: SortOrder
    thermalStatus?: SortOrder
    sessionProgress?: SortOrder
    totalHealedCount?: SortOrder
    ip?: SortOrder
    cpuArchitecture?: SortOrder
    owning_session_id?: SortOrder
    locked_at?: SortOrder
  }

  export type DeviceMinOrderByAggregateInput = {
    udid?: SortOrder
    host?: SortOrder
    systemPort?: SortOrder
    proxyPort?: SortOrder
    proxyHost?: SortOrder
    wdaLocalPort?: SortOrder
    name?: SortOrder
    state?: SortOrder
    sdk?: SortOrder
    platform?: SortOrder
    deviceType?: SortOrder
    busy?: SortOrder
    userBlocked?: SortOrder
    realDevice?: SortOrder
    session_id?: SortOrder
    offline?: SortOrder
    mjpegServerPort?: SortOrder
    lastCmdExecutedAt?: SortOrder
    totalUtilizationTimeMilliSec?: SortOrder
    sessionStartTime?: SortOrder
    newCommandTimeout?: SortOrder
    cloud?: SortOrder
    derivedDataPath?: SortOrder
    chromeDriverPath?: SortOrder
    capability?: SortOrder
    adbRemoteHost?: SortOrder
    adbPort?: SortOrder
    nodeId?: SortOrder
    screenWidth?: SortOrder
    screenHeight?: SortOrder
    dashboard_link?: SortOrder
    total_session_count?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    healthCheckError?: SortOrder
    healthStatus?: SortOrder
    lastHealthCheckAt?: SortOrder
    batteryLevel?: SortOrder
    reservationReason?: SortOrder
    reservedBy?: SortOrder
    reservedUntil?: SortOrder
    storageFree?: SortOrder
    tags?: SortOrder
    thermalStatus?: SortOrder
    sessionProgress?: SortOrder
    totalHealedCount?: SortOrder
    ip?: SortOrder
    cpuArchitecture?: SortOrder
    owning_session_id?: SortOrder
    locked_at?: SortOrder
  }

  export type DeviceSumOrderByAggregateInput = {
    systemPort?: SortOrder
    proxyPort?: SortOrder
    wdaLocalPort?: SortOrder
    mjpegServerPort?: SortOrder
    lastCmdExecutedAt?: SortOrder
    totalUtilizationTimeMilliSec?: SortOrder
    sessionStartTime?: SortOrder
    newCommandTimeout?: SortOrder
    adbPort?: SortOrder
    total_session_count?: SortOrder
    lastHealthCheckAt?: SortOrder
    batteryLevel?: SortOrder
    reservedUntil?: SortOrder
    totalHealedCount?: SortOrder
    locked_at?: SortOrder
  }

  export type FloatWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[]
    notIn?: number[]
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedFloatFilter<$PrismaModel>
    _min?: NestedFloatFilter<$PrismaModel>
    _max?: NestedFloatFilter<$PrismaModel>
  }

  export type PendingSessionCountOrderByAggregateInput = {
    id?: SortOrder
    capability_id?: SortOrder
    capability?: SortOrder
    createdAt?: SortOrder
  }

  export type PendingSessionAvgOrderByAggregateInput = {
    id?: SortOrder
    createdAt?: SortOrder
  }

  export type PendingSessionMaxOrderByAggregateInput = {
    id?: SortOrder
    capability_id?: SortOrder
    capability?: SortOrder
    createdAt?: SortOrder
  }

  export type PendingSessionMinOrderByAggregateInput = {
    id?: SortOrder
    capability_id?: SortOrder
    capability?: SortOrder
    createdAt?: SortOrder
  }

  export type PendingSessionSumOrderByAggregateInput = {
    id?: SortOrder
    createdAt?: SortOrder
  }

  export type CLIArgsCountOrderByAggregateInput = {
    id?: SortOrder
    args?: SortOrder
    createdAt?: SortOrder
  }

  export type CLIArgsAvgOrderByAggregateInput = {
    id?: SortOrder
  }

  export type CLIArgsMaxOrderByAggregateInput = {
    id?: SortOrder
    args?: SortOrder
    createdAt?: SortOrder
  }

  export type CLIArgsMinOrderByAggregateInput = {
    id?: SortOrder
    args?: SortOrder
    createdAt?: SortOrder
  }

  export type CLIArgsSumOrderByAggregateInput = {
    id?: SortOrder
  }

  export type WebhookConfigCountOrderByAggregateInput = {
    id?: SortOrder
    url?: SortOrder
    type?: SortOrder
    events?: SortOrder
    active?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    payloadTemplate?: SortOrder
  }

  export type WebhookConfigMaxOrderByAggregateInput = {
    id?: SortOrder
    url?: SortOrder
    type?: SortOrder
    events?: SortOrder
    active?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    payloadTemplate?: SortOrder
  }

  export type WebhookConfigMinOrderByAggregateInput = {
    id?: SortOrder
    url?: SortOrder
    type?: SortOrder
    events?: SortOrder
    active?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    payloadTemplate?: SortOrder
  }

  export type WebConfigCountOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    value?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type WebConfigMaxOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    value?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type WebConfigMinOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    value?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type LocatorEtalonCountOrderByAggregateInput = {
    id?: SortOrder
    selector?: SortOrder
    strategy?: SortOrder
    attributes?: SortOrder
    nodeName?: SortOrder
    lastSeen?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type LocatorEtalonMaxOrderByAggregateInput = {
    id?: SortOrder
    selector?: SortOrder
    strategy?: SortOrder
    attributes?: SortOrder
    nodeName?: SortOrder
    lastSeen?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type LocatorEtalonMinOrderByAggregateInput = {
    id?: SortOrder
    selector?: SortOrder
    strategy?: SortOrder
    attributes?: SortOrder
    nodeName?: SortOrder
    lastSeen?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type SessionCreateNestedManyWithoutBuildInput = {
    create?: XOR<SessionCreateWithoutBuildInput, SessionUncheckedCreateWithoutBuildInput> | SessionCreateWithoutBuildInput[] | SessionUncheckedCreateWithoutBuildInput[]
    connectOrCreate?: SessionCreateOrConnectWithoutBuildInput | SessionCreateOrConnectWithoutBuildInput[]
    createMany?: SessionCreateManyBuildInputEnvelope
    connect?: SessionWhereUniqueInput | SessionWhereUniqueInput[]
  }

  export type SessionUncheckedCreateNestedManyWithoutBuildInput = {
    create?: XOR<SessionCreateWithoutBuildInput, SessionUncheckedCreateWithoutBuildInput> | SessionCreateWithoutBuildInput[] | SessionUncheckedCreateWithoutBuildInput[]
    connectOrCreate?: SessionCreateOrConnectWithoutBuildInput | SessionCreateOrConnectWithoutBuildInput[]
    createMany?: SessionCreateManyBuildInputEnvelope
    connect?: SessionWhereUniqueInput | SessionWhereUniqueInput[]
  }

  export type StringFieldUpdateOperationsInput = {
    set?: string
  }

  export type NullableStringFieldUpdateOperationsInput = {
    set?: string | null
  }

  export type DateTimeFieldUpdateOperationsInput = {
    set?: Date | string
  }

  export type SessionUpdateManyWithoutBuildNestedInput = {
    create?: XOR<SessionCreateWithoutBuildInput, SessionUncheckedCreateWithoutBuildInput> | SessionCreateWithoutBuildInput[] | SessionUncheckedCreateWithoutBuildInput[]
    connectOrCreate?: SessionCreateOrConnectWithoutBuildInput | SessionCreateOrConnectWithoutBuildInput[]
    upsert?: SessionUpsertWithWhereUniqueWithoutBuildInput | SessionUpsertWithWhereUniqueWithoutBuildInput[]
    createMany?: SessionCreateManyBuildInputEnvelope
    set?: SessionWhereUniqueInput | SessionWhereUniqueInput[]
    disconnect?: SessionWhereUniqueInput | SessionWhereUniqueInput[]
    delete?: SessionWhereUniqueInput | SessionWhereUniqueInput[]
    connect?: SessionWhereUniqueInput | SessionWhereUniqueInput[]
    update?: SessionUpdateWithWhereUniqueWithoutBuildInput | SessionUpdateWithWhereUniqueWithoutBuildInput[]
    updateMany?: SessionUpdateManyWithWhereWithoutBuildInput | SessionUpdateManyWithWhereWithoutBuildInput[]
    deleteMany?: SessionScalarWhereInput | SessionScalarWhereInput[]
  }

  export type SessionUncheckedUpdateManyWithoutBuildNestedInput = {
    create?: XOR<SessionCreateWithoutBuildInput, SessionUncheckedCreateWithoutBuildInput> | SessionCreateWithoutBuildInput[] | SessionUncheckedCreateWithoutBuildInput[]
    connectOrCreate?: SessionCreateOrConnectWithoutBuildInput | SessionCreateOrConnectWithoutBuildInput[]
    upsert?: SessionUpsertWithWhereUniqueWithoutBuildInput | SessionUpsertWithWhereUniqueWithoutBuildInput[]
    createMany?: SessionCreateManyBuildInputEnvelope
    set?: SessionWhereUniqueInput | SessionWhereUniqueInput[]
    disconnect?: SessionWhereUniqueInput | SessionWhereUniqueInput[]
    delete?: SessionWhereUniqueInput | SessionWhereUniqueInput[]
    connect?: SessionWhereUniqueInput | SessionWhereUniqueInput[]
    update?: SessionUpdateWithWhereUniqueWithoutBuildInput | SessionUpdateWithWhereUniqueWithoutBuildInput[]
    updateMany?: SessionUpdateManyWithWhereWithoutBuildInput | SessionUpdateManyWithWhereWithoutBuildInput[]
    deleteMany?: SessionScalarWhereInput | SessionScalarWhereInput[]
  }

  export type LogCreateNestedManyWithoutSessionInput = {
    create?: XOR<LogCreateWithoutSessionInput, LogUncheckedCreateWithoutSessionInput> | LogCreateWithoutSessionInput[] | LogUncheckedCreateWithoutSessionInput[]
    connectOrCreate?: LogCreateOrConnectWithoutSessionInput | LogCreateOrConnectWithoutSessionInput[]
    createMany?: LogCreateManySessionInputEnvelope
    connect?: LogWhereUniqueInput | LogWhereUniqueInput[]
  }

  export type ProfilingCreateNestedManyWithoutSessionInput = {
    create?: XOR<ProfilingCreateWithoutSessionInput, ProfilingUncheckedCreateWithoutSessionInput> | ProfilingCreateWithoutSessionInput[] | ProfilingUncheckedCreateWithoutSessionInput[]
    connectOrCreate?: ProfilingCreateOrConnectWithoutSessionInput | ProfilingCreateOrConnectWithoutSessionInput[]
    createMany?: ProfilingCreateManySessionInputEnvelope
    connect?: ProfilingWhereUniqueInput | ProfilingWhereUniqueInput[]
  }

  export type BuildCreateNestedOneWithoutSessionsInput = {
    create?: XOR<BuildCreateWithoutSessionsInput, BuildUncheckedCreateWithoutSessionsInput>
    connectOrCreate?: BuildCreateOrConnectWithoutSessionsInput
    connect?: BuildWhereUniqueInput
  }

  export type SessionLogCreateNestedManyWithoutSessionInput = {
    create?: XOR<SessionLogCreateWithoutSessionInput, SessionLogUncheckedCreateWithoutSessionInput> | SessionLogCreateWithoutSessionInput[] | SessionLogUncheckedCreateWithoutSessionInput[]
    connectOrCreate?: SessionLogCreateOrConnectWithoutSessionInput | SessionLogCreateOrConnectWithoutSessionInput[]
    createMany?: SessionLogCreateManySessionInputEnvelope
    connect?: SessionLogWhereUniqueInput | SessionLogWhereUniqueInput[]
  }

  export type LogUncheckedCreateNestedManyWithoutSessionInput = {
    create?: XOR<LogCreateWithoutSessionInput, LogUncheckedCreateWithoutSessionInput> | LogCreateWithoutSessionInput[] | LogUncheckedCreateWithoutSessionInput[]
    connectOrCreate?: LogCreateOrConnectWithoutSessionInput | LogCreateOrConnectWithoutSessionInput[]
    createMany?: LogCreateManySessionInputEnvelope
    connect?: LogWhereUniqueInput | LogWhereUniqueInput[]
  }

  export type ProfilingUncheckedCreateNestedManyWithoutSessionInput = {
    create?: XOR<ProfilingCreateWithoutSessionInput, ProfilingUncheckedCreateWithoutSessionInput> | ProfilingCreateWithoutSessionInput[] | ProfilingUncheckedCreateWithoutSessionInput[]
    connectOrCreate?: ProfilingCreateOrConnectWithoutSessionInput | ProfilingCreateOrConnectWithoutSessionInput[]
    createMany?: ProfilingCreateManySessionInputEnvelope
    connect?: ProfilingWhereUniqueInput | ProfilingWhereUniqueInput[]
  }

  export type SessionLogUncheckedCreateNestedManyWithoutSessionInput = {
    create?: XOR<SessionLogCreateWithoutSessionInput, SessionLogUncheckedCreateWithoutSessionInput> | SessionLogCreateWithoutSessionInput[] | SessionLogUncheckedCreateWithoutSessionInput[]
    connectOrCreate?: SessionLogCreateOrConnectWithoutSessionInput | SessionLogCreateOrConnectWithoutSessionInput[]
    createMany?: SessionLogCreateManySessionInputEnvelope
    connect?: SessionLogWhereUniqueInput | SessionLogWhereUniqueInput[]
  }

  export type BoolFieldUpdateOperationsInput = {
    set?: boolean
  }

  export type NullableDateTimeFieldUpdateOperationsInput = {
    set?: Date | string | null
  }

  export type NullableIntFieldUpdateOperationsInput = {
    set?: number | null
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type LogUpdateManyWithoutSessionNestedInput = {
    create?: XOR<LogCreateWithoutSessionInput, LogUncheckedCreateWithoutSessionInput> | LogCreateWithoutSessionInput[] | LogUncheckedCreateWithoutSessionInput[]
    connectOrCreate?: LogCreateOrConnectWithoutSessionInput | LogCreateOrConnectWithoutSessionInput[]
    upsert?: LogUpsertWithWhereUniqueWithoutSessionInput | LogUpsertWithWhereUniqueWithoutSessionInput[]
    createMany?: LogCreateManySessionInputEnvelope
    set?: LogWhereUniqueInput | LogWhereUniqueInput[]
    disconnect?: LogWhereUniqueInput | LogWhereUniqueInput[]
    delete?: LogWhereUniqueInput | LogWhereUniqueInput[]
    connect?: LogWhereUniqueInput | LogWhereUniqueInput[]
    update?: LogUpdateWithWhereUniqueWithoutSessionInput | LogUpdateWithWhereUniqueWithoutSessionInput[]
    updateMany?: LogUpdateManyWithWhereWithoutSessionInput | LogUpdateManyWithWhereWithoutSessionInput[]
    deleteMany?: LogScalarWhereInput | LogScalarWhereInput[]
  }

  export type ProfilingUpdateManyWithoutSessionNestedInput = {
    create?: XOR<ProfilingCreateWithoutSessionInput, ProfilingUncheckedCreateWithoutSessionInput> | ProfilingCreateWithoutSessionInput[] | ProfilingUncheckedCreateWithoutSessionInput[]
    connectOrCreate?: ProfilingCreateOrConnectWithoutSessionInput | ProfilingCreateOrConnectWithoutSessionInput[]
    upsert?: ProfilingUpsertWithWhereUniqueWithoutSessionInput | ProfilingUpsertWithWhereUniqueWithoutSessionInput[]
    createMany?: ProfilingCreateManySessionInputEnvelope
    set?: ProfilingWhereUniqueInput | ProfilingWhereUniqueInput[]
    disconnect?: ProfilingWhereUniqueInput | ProfilingWhereUniqueInput[]
    delete?: ProfilingWhereUniqueInput | ProfilingWhereUniqueInput[]
    connect?: ProfilingWhereUniqueInput | ProfilingWhereUniqueInput[]
    update?: ProfilingUpdateWithWhereUniqueWithoutSessionInput | ProfilingUpdateWithWhereUniqueWithoutSessionInput[]
    updateMany?: ProfilingUpdateManyWithWhereWithoutSessionInput | ProfilingUpdateManyWithWhereWithoutSessionInput[]
    deleteMany?: ProfilingScalarWhereInput | ProfilingScalarWhereInput[]
  }

  export type BuildUpdateOneWithoutSessionsNestedInput = {
    create?: XOR<BuildCreateWithoutSessionsInput, BuildUncheckedCreateWithoutSessionsInput>
    connectOrCreate?: BuildCreateOrConnectWithoutSessionsInput
    upsert?: BuildUpsertWithoutSessionsInput
    disconnect?: BuildWhereInput | boolean
    delete?: BuildWhereInput | boolean
    connect?: BuildWhereUniqueInput
    update?: XOR<XOR<BuildUpdateToOneWithWhereWithoutSessionsInput, BuildUpdateWithoutSessionsInput>, BuildUncheckedUpdateWithoutSessionsInput>
  }

  export type SessionLogUpdateManyWithoutSessionNestedInput = {
    create?: XOR<SessionLogCreateWithoutSessionInput, SessionLogUncheckedCreateWithoutSessionInput> | SessionLogCreateWithoutSessionInput[] | SessionLogUncheckedCreateWithoutSessionInput[]
    connectOrCreate?: SessionLogCreateOrConnectWithoutSessionInput | SessionLogCreateOrConnectWithoutSessionInput[]
    upsert?: SessionLogUpsertWithWhereUniqueWithoutSessionInput | SessionLogUpsertWithWhereUniqueWithoutSessionInput[]
    createMany?: SessionLogCreateManySessionInputEnvelope
    set?: SessionLogWhereUniqueInput | SessionLogWhereUniqueInput[]
    disconnect?: SessionLogWhereUniqueInput | SessionLogWhereUniqueInput[]
    delete?: SessionLogWhereUniqueInput | SessionLogWhereUniqueInput[]
    connect?: SessionLogWhereUniqueInput | SessionLogWhereUniqueInput[]
    update?: SessionLogUpdateWithWhereUniqueWithoutSessionInput | SessionLogUpdateWithWhereUniqueWithoutSessionInput[]
    updateMany?: SessionLogUpdateManyWithWhereWithoutSessionInput | SessionLogUpdateManyWithWhereWithoutSessionInput[]
    deleteMany?: SessionLogScalarWhereInput | SessionLogScalarWhereInput[]
  }

  export type LogUncheckedUpdateManyWithoutSessionNestedInput = {
    create?: XOR<LogCreateWithoutSessionInput, LogUncheckedCreateWithoutSessionInput> | LogCreateWithoutSessionInput[] | LogUncheckedCreateWithoutSessionInput[]
    connectOrCreate?: LogCreateOrConnectWithoutSessionInput | LogCreateOrConnectWithoutSessionInput[]
    upsert?: LogUpsertWithWhereUniqueWithoutSessionInput | LogUpsertWithWhereUniqueWithoutSessionInput[]
    createMany?: LogCreateManySessionInputEnvelope
    set?: LogWhereUniqueInput | LogWhereUniqueInput[]
    disconnect?: LogWhereUniqueInput | LogWhereUniqueInput[]
    delete?: LogWhereUniqueInput | LogWhereUniqueInput[]
    connect?: LogWhereUniqueInput | LogWhereUniqueInput[]
    update?: LogUpdateWithWhereUniqueWithoutSessionInput | LogUpdateWithWhereUniqueWithoutSessionInput[]
    updateMany?: LogUpdateManyWithWhereWithoutSessionInput | LogUpdateManyWithWhereWithoutSessionInput[]
    deleteMany?: LogScalarWhereInput | LogScalarWhereInput[]
  }

  export type ProfilingUncheckedUpdateManyWithoutSessionNestedInput = {
    create?: XOR<ProfilingCreateWithoutSessionInput, ProfilingUncheckedCreateWithoutSessionInput> | ProfilingCreateWithoutSessionInput[] | ProfilingUncheckedCreateWithoutSessionInput[]
    connectOrCreate?: ProfilingCreateOrConnectWithoutSessionInput | ProfilingCreateOrConnectWithoutSessionInput[]
    upsert?: ProfilingUpsertWithWhereUniqueWithoutSessionInput | ProfilingUpsertWithWhereUniqueWithoutSessionInput[]
    createMany?: ProfilingCreateManySessionInputEnvelope
    set?: ProfilingWhereUniqueInput | ProfilingWhereUniqueInput[]
    disconnect?: ProfilingWhereUniqueInput | ProfilingWhereUniqueInput[]
    delete?: ProfilingWhereUniqueInput | ProfilingWhereUniqueInput[]
    connect?: ProfilingWhereUniqueInput | ProfilingWhereUniqueInput[]
    update?: ProfilingUpdateWithWhereUniqueWithoutSessionInput | ProfilingUpdateWithWhereUniqueWithoutSessionInput[]
    updateMany?: ProfilingUpdateManyWithWhereWithoutSessionInput | ProfilingUpdateManyWithWhereWithoutSessionInput[]
    deleteMany?: ProfilingScalarWhereInput | ProfilingScalarWhereInput[]
  }

  export type SessionLogUncheckedUpdateManyWithoutSessionNestedInput = {
    create?: XOR<SessionLogCreateWithoutSessionInput, SessionLogUncheckedCreateWithoutSessionInput> | SessionLogCreateWithoutSessionInput[] | SessionLogUncheckedCreateWithoutSessionInput[]
    connectOrCreate?: SessionLogCreateOrConnectWithoutSessionInput | SessionLogCreateOrConnectWithoutSessionInput[]
    upsert?: SessionLogUpsertWithWhereUniqueWithoutSessionInput | SessionLogUpsertWithWhereUniqueWithoutSessionInput[]
    createMany?: SessionLogCreateManySessionInputEnvelope
    set?: SessionLogWhereUniqueInput | SessionLogWhereUniqueInput[]
    disconnect?: SessionLogWhereUniqueInput | SessionLogWhereUniqueInput[]
    delete?: SessionLogWhereUniqueInput | SessionLogWhereUniqueInput[]
    connect?: SessionLogWhereUniqueInput | SessionLogWhereUniqueInput[]
    update?: SessionLogUpdateWithWhereUniqueWithoutSessionInput | SessionLogUpdateWithWhereUniqueWithoutSessionInput[]
    updateMany?: SessionLogUpdateManyWithWhereWithoutSessionInput | SessionLogUpdateManyWithWhereWithoutSessionInput[]
    deleteMany?: SessionLogScalarWhereInput | SessionLogScalarWhereInput[]
  }

  export type SessionCreateNestedOneWithoutSessionLogInput = {
    create?: XOR<SessionCreateWithoutSessionLogInput, SessionUncheckedCreateWithoutSessionLogInput>
    connectOrCreate?: SessionCreateOrConnectWithoutSessionLogInput
    connect?: SessionWhereUniqueInput
  }

  export type NullableBoolFieldUpdateOperationsInput = {
    set?: boolean | null
  }

  export type NullableFloatFieldUpdateOperationsInput = {
    set?: number | null
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type SessionUpdateOneRequiredWithoutSessionLogNestedInput = {
    create?: XOR<SessionCreateWithoutSessionLogInput, SessionUncheckedCreateWithoutSessionLogInput>
    connectOrCreate?: SessionCreateOrConnectWithoutSessionLogInput
    upsert?: SessionUpsertWithoutSessionLogInput
    connect?: SessionWhereUniqueInput
    update?: XOR<XOR<SessionUpdateToOneWithWhereWithoutSessionLogInput, SessionUpdateWithoutSessionLogInput>, SessionUncheckedUpdateWithoutSessionLogInput>
  }

  export type SessionCreateNestedOneWithoutLogInput = {
    create?: XOR<SessionCreateWithoutLogInput, SessionUncheckedCreateWithoutLogInput>
    connectOrCreate?: SessionCreateOrConnectWithoutLogInput
    connect?: SessionWhereUniqueInput
  }

  export type SessionUpdateOneRequiredWithoutLogNestedInput = {
    create?: XOR<SessionCreateWithoutLogInput, SessionUncheckedCreateWithoutLogInput>
    connectOrCreate?: SessionCreateOrConnectWithoutLogInput
    upsert?: SessionUpsertWithoutLogInput
    connect?: SessionWhereUniqueInput
    update?: XOR<XOR<SessionUpdateToOneWithWhereWithoutLogInput, SessionUpdateWithoutLogInput>, SessionUncheckedUpdateWithoutLogInput>
  }

  export type SessionCreateNestedOneWithoutProfilingInput = {
    create?: XOR<SessionCreateWithoutProfilingInput, SessionUncheckedCreateWithoutProfilingInput>
    connectOrCreate?: SessionCreateOrConnectWithoutProfilingInput
    connect?: SessionWhereUniqueInput
  }

  export type SessionUpdateOneRequiredWithoutProfilingNestedInput = {
    create?: XOR<SessionCreateWithoutProfilingInput, SessionUncheckedCreateWithoutProfilingInput>
    connectOrCreate?: SessionCreateOrConnectWithoutProfilingInput
    upsert?: SessionUpsertWithoutProfilingInput
    connect?: SessionWhereUniqueInput
    update?: XOR<XOR<SessionUpdateToOneWithWhereWithoutProfilingInput, SessionUpdateWithoutProfilingInput>, SessionUncheckedUpdateWithoutProfilingInput>
  }

  export type IntFieldUpdateOperationsInput = {
    set?: number
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type FloatFieldUpdateOperationsInput = {
    set?: number
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type NestedStringFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[]
    notIn?: string[]
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringFilter<$PrismaModel> | string
  }

  export type NestedStringNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | null
    notIn?: string[] | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringNullableFilter<$PrismaModel> | string | null
  }

  export type NestedDateTimeFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[]
    notIn?: Date[] | string[]
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeFilter<$PrismaModel> | Date | string
  }

  export type NestedStringWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[]
    notIn?: string[]
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }

  export type NestedIntFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[]
    notIn?: number[]
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntFilter<$PrismaModel> | number
  }

  export type NestedStringNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | null
    notIn?: string[] | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }

  export type NestedIntNullableFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | null
    notIn?: number[] | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableFilter<$PrismaModel> | number | null
  }

  export type NestedDateTimeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[]
    notIn?: Date[] | string[]
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeWithAggregatesFilter<$PrismaModel> | Date | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedDateTimeFilter<$PrismaModel>
    _max?: NestedDateTimeFilter<$PrismaModel>
  }

  export type NestedBoolFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolFilter<$PrismaModel> | boolean
  }

  export type NestedDateTimeNullableFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | null
    notIn?: Date[] | string[] | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableFilter<$PrismaModel> | Date | string | null
  }

  export type NestedBoolWithAggregatesFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolWithAggregatesFilter<$PrismaModel> | boolean
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedBoolFilter<$PrismaModel>
    _max?: NestedBoolFilter<$PrismaModel>
  }

  export type NestedDateTimeNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | null
    notIn?: Date[] | string[] | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableWithAggregatesFilter<$PrismaModel> | Date | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedDateTimeNullableFilter<$PrismaModel>
    _max?: NestedDateTimeNullableFilter<$PrismaModel>
  }

  export type NestedIntNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | null
    notIn?: number[] | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableWithAggregatesFilter<$PrismaModel> | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedIntNullableFilter<$PrismaModel>
    _max?: NestedIntNullableFilter<$PrismaModel>
  }

  export type NestedFloatNullableFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel> | null
    in?: number[] | null
    notIn?: number[] | null
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatNullableFilter<$PrismaModel> | number | null
  }

  export type NestedBoolNullableFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel> | null
    not?: NestedBoolNullableFilter<$PrismaModel> | boolean | null
  }

  export type NestedBoolNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel> | null
    not?: NestedBoolNullableWithAggregatesFilter<$PrismaModel> | boolean | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedBoolNullableFilter<$PrismaModel>
    _max?: NestedBoolNullableFilter<$PrismaModel>
  }

  export type NestedFloatNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel> | null
    in?: number[] | null
    notIn?: number[] | null
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatNullableWithAggregatesFilter<$PrismaModel> | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedFloatNullableFilter<$PrismaModel>
    _min?: NestedFloatNullableFilter<$PrismaModel>
    _max?: NestedFloatNullableFilter<$PrismaModel>
  }

  export type NestedIntWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[]
    notIn?: number[]
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedIntFilter<$PrismaModel>
    _min?: NestedIntFilter<$PrismaModel>
    _max?: NestedIntFilter<$PrismaModel>
  }

  export type NestedFloatFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[]
    notIn?: number[]
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatFilter<$PrismaModel> | number
  }

  export type NestedFloatWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[]
    notIn?: number[]
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedFloatFilter<$PrismaModel>
    _min?: NestedFloatFilter<$PrismaModel>
    _max?: NestedFloatFilter<$PrismaModel>
  }

  export type SessionCreateWithoutBuildInput = {
    id: string
    name?: string | null
    status?: string
    desired_capabilities: string
    session_capabilities: string
    node_id: string
    has_live_video: boolean
    video_recording_enabled?: boolean
    video_recording?: string | null
    startTime?: Date | string
    endTime?: Date | string | null
    failure_reason?: string | null
    is_profiling_available?: boolean
    device_info?: string | null
    device_udid: string
    device_platform: string
    device_version: string
    device_name?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    performance_trace?: string | null
    failure_category?: string | null
    ai_analysis?: string | null
    tags?: string | null
    trace_id?: string | null
    last_heartbeat_at?: Date | string | null
    heartbeat_pid?: number | null
    heartbeat_host?: string | null
    Log?: LogCreateNestedManyWithoutSessionInput
    Profiling?: ProfilingCreateNestedManyWithoutSessionInput
    SessionLog?: SessionLogCreateNestedManyWithoutSessionInput
  }

  export type SessionUncheckedCreateWithoutBuildInput = {
    id: string
    name?: string | null
    status?: string
    desired_capabilities: string
    session_capabilities: string
    node_id: string
    has_live_video: boolean
    video_recording_enabled?: boolean
    video_recording?: string | null
    startTime?: Date | string
    endTime?: Date | string | null
    failure_reason?: string | null
    is_profiling_available?: boolean
    device_info?: string | null
    device_udid: string
    device_platform: string
    device_version: string
    device_name?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    performance_trace?: string | null
    failure_category?: string | null
    ai_analysis?: string | null
    tags?: string | null
    trace_id?: string | null
    last_heartbeat_at?: Date | string | null
    heartbeat_pid?: number | null
    heartbeat_host?: string | null
    Log?: LogUncheckedCreateNestedManyWithoutSessionInput
    Profiling?: ProfilingUncheckedCreateNestedManyWithoutSessionInput
    SessionLog?: SessionLogUncheckedCreateNestedManyWithoutSessionInput
  }

  export type SessionCreateOrConnectWithoutBuildInput = {
    where: SessionWhereUniqueInput
    create: XOR<SessionCreateWithoutBuildInput, SessionUncheckedCreateWithoutBuildInput>
  }

  export type SessionCreateManyBuildInputEnvelope = {
    data: SessionCreateManyBuildInput | SessionCreateManyBuildInput[]
  }

  export type SessionUpsertWithWhereUniqueWithoutBuildInput = {
    where: SessionWhereUniqueInput
    update: XOR<SessionUpdateWithoutBuildInput, SessionUncheckedUpdateWithoutBuildInput>
    create: XOR<SessionCreateWithoutBuildInput, SessionUncheckedCreateWithoutBuildInput>
  }

  export type SessionUpdateWithWhereUniqueWithoutBuildInput = {
    where: SessionWhereUniqueInput
    data: XOR<SessionUpdateWithoutBuildInput, SessionUncheckedUpdateWithoutBuildInput>
  }

  export type SessionUpdateManyWithWhereWithoutBuildInput = {
    where: SessionScalarWhereInput
    data: XOR<SessionUpdateManyMutationInput, SessionUncheckedUpdateManyWithoutBuildInput>
  }

  export type SessionScalarWhereInput = {
    AND?: SessionScalarWhereInput | SessionScalarWhereInput[]
    OR?: SessionScalarWhereInput[]
    NOT?: SessionScalarWhereInput | SessionScalarWhereInput[]
    id?: StringFilter<"Session"> | string
    build_id?: StringNullableFilter<"Session"> | string | null
    name?: StringNullableFilter<"Session"> | string | null
    status?: StringFilter<"Session"> | string
    desired_capabilities?: StringFilter<"Session"> | string
    session_capabilities?: StringFilter<"Session"> | string
    node_id?: StringFilter<"Session"> | string
    has_live_video?: BoolFilter<"Session"> | boolean
    video_recording_enabled?: BoolFilter<"Session"> | boolean
    video_recording?: StringNullableFilter<"Session"> | string | null
    startTime?: DateTimeFilter<"Session"> | Date | string
    endTime?: DateTimeNullableFilter<"Session"> | Date | string | null
    failure_reason?: StringNullableFilter<"Session"> | string | null
    is_profiling_available?: BoolFilter<"Session"> | boolean
    device_info?: StringNullableFilter<"Session"> | string | null
    device_udid?: StringFilter<"Session"> | string
    device_platform?: StringFilter<"Session"> | string
    device_version?: StringFilter<"Session"> | string
    device_name?: StringNullableFilter<"Session"> | string | null
    createdAt?: DateTimeFilter<"Session"> | Date | string
    updatedAt?: DateTimeFilter<"Session"> | Date | string
    performance_trace?: StringNullableFilter<"Session"> | string | null
    failure_category?: StringNullableFilter<"Session"> | string | null
    ai_analysis?: StringNullableFilter<"Session"> | string | null
    tags?: StringNullableFilter<"Session"> | string | null
    trace_id?: StringNullableFilter<"Session"> | string | null
    last_heartbeat_at?: DateTimeNullableFilter<"Session"> | Date | string | null
    heartbeat_pid?: IntNullableFilter<"Session"> | number | null
    heartbeat_host?: StringNullableFilter<"Session"> | string | null
  }

  export type LogCreateWithoutSessionInput = {
    id?: string
    log_type: string
    message: string
    timestamp?: Date | string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type LogUncheckedCreateWithoutSessionInput = {
    id?: string
    log_type: string
    message: string
    timestamp?: Date | string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type LogCreateOrConnectWithoutSessionInput = {
    where: LogWhereUniqueInput
    create: XOR<LogCreateWithoutSessionInput, LogUncheckedCreateWithoutSessionInput>
  }

  export type LogCreateManySessionInputEnvelope = {
    data: LogCreateManySessionInput | LogCreateManySessionInput[]
  }

  export type ProfilingCreateWithoutSessionInput = {
    cpu?: string | null
    memory?: string | null
    total_cpu_used?: string | null
    total_memory_used?: string | null
    raw_cpu_log?: string | null
    raw_memory_log?: string | null
    timestamp: Date | string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type ProfilingUncheckedCreateWithoutSessionInput = {
    id?: number
    cpu?: string | null
    memory?: string | null
    total_cpu_used?: string | null
    total_memory_used?: string | null
    raw_cpu_log?: string | null
    raw_memory_log?: string | null
    timestamp: Date | string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type ProfilingCreateOrConnectWithoutSessionInput = {
    where: ProfilingWhereUniqueInput
    create: XOR<ProfilingCreateWithoutSessionInput, ProfilingUncheckedCreateWithoutSessionInput>
  }

  export type ProfilingCreateManySessionInputEnvelope = {
    data: ProfilingCreateManySessionInput | ProfilingCreateManySessionInput[]
  }

  export type BuildCreateWithoutSessionsInput = {
    id?: string
    name?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type BuildUncheckedCreateWithoutSessionsInput = {
    id?: string
    name?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type BuildCreateOrConnectWithoutSessionsInput = {
    where: BuildWhereUniqueInput
    create: XOR<BuildCreateWithoutSessionsInput, BuildUncheckedCreateWithoutSessionsInput>
  }

  export type SessionLogCreateWithoutSessionInput = {
    id?: string
    command_name?: string | null
    url: string
    method: string
    title: string
    subtitle?: string | null
    body?: string | null
    response: string
    screenshot?: string | null
    is_success?: boolean | null
    is_error?: boolean
    is_healed?: boolean
    original_selector?: string | null
    healed_selector?: string | null
    healing_confidence?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
    duration?: number | null
    span_id?: string | null
    trace_id?: string | null
  }

  export type SessionLogUncheckedCreateWithoutSessionInput = {
    id?: string
    command_name?: string | null
    url: string
    method: string
    title: string
    subtitle?: string | null
    body?: string | null
    response: string
    screenshot?: string | null
    is_success?: boolean | null
    is_error?: boolean
    is_healed?: boolean
    original_selector?: string | null
    healed_selector?: string | null
    healing_confidence?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
    duration?: number | null
    span_id?: string | null
    trace_id?: string | null
  }

  export type SessionLogCreateOrConnectWithoutSessionInput = {
    where: SessionLogWhereUniqueInput
    create: XOR<SessionLogCreateWithoutSessionInput, SessionLogUncheckedCreateWithoutSessionInput>
  }

  export type SessionLogCreateManySessionInputEnvelope = {
    data: SessionLogCreateManySessionInput | SessionLogCreateManySessionInput[]
  }

  export type LogUpsertWithWhereUniqueWithoutSessionInput = {
    where: LogWhereUniqueInput
    update: XOR<LogUpdateWithoutSessionInput, LogUncheckedUpdateWithoutSessionInput>
    create: XOR<LogCreateWithoutSessionInput, LogUncheckedCreateWithoutSessionInput>
  }

  export type LogUpdateWithWhereUniqueWithoutSessionInput = {
    where: LogWhereUniqueInput
    data: XOR<LogUpdateWithoutSessionInput, LogUncheckedUpdateWithoutSessionInput>
  }

  export type LogUpdateManyWithWhereWithoutSessionInput = {
    where: LogScalarWhereInput
    data: XOR<LogUpdateManyMutationInput, LogUncheckedUpdateManyWithoutSessionInput>
  }

  export type LogScalarWhereInput = {
    AND?: LogScalarWhereInput | LogScalarWhereInput[]
    OR?: LogScalarWhereInput[]
    NOT?: LogScalarWhereInput | LogScalarWhereInput[]
    id?: StringFilter<"Log"> | string
    session_id?: StringFilter<"Log"> | string
    log_type?: StringFilter<"Log"> | string
    message?: StringFilter<"Log"> | string
    timestamp?: DateTimeFilter<"Log"> | Date | string
    createdAt?: DateTimeFilter<"Log"> | Date | string
    updatedAt?: DateTimeFilter<"Log"> | Date | string
  }

  export type ProfilingUpsertWithWhereUniqueWithoutSessionInput = {
    where: ProfilingWhereUniqueInput
    update: XOR<ProfilingUpdateWithoutSessionInput, ProfilingUncheckedUpdateWithoutSessionInput>
    create: XOR<ProfilingCreateWithoutSessionInput, ProfilingUncheckedCreateWithoutSessionInput>
  }

  export type ProfilingUpdateWithWhereUniqueWithoutSessionInput = {
    where: ProfilingWhereUniqueInput
    data: XOR<ProfilingUpdateWithoutSessionInput, ProfilingUncheckedUpdateWithoutSessionInput>
  }

  export type ProfilingUpdateManyWithWhereWithoutSessionInput = {
    where: ProfilingScalarWhereInput
    data: XOR<ProfilingUpdateManyMutationInput, ProfilingUncheckedUpdateManyWithoutSessionInput>
  }

  export type ProfilingScalarWhereInput = {
    AND?: ProfilingScalarWhereInput | ProfilingScalarWhereInput[]
    OR?: ProfilingScalarWhereInput[]
    NOT?: ProfilingScalarWhereInput | ProfilingScalarWhereInput[]
    id?: IntFilter<"Profiling"> | number
    session_id?: StringFilter<"Profiling"> | string
    cpu?: StringNullableFilter<"Profiling"> | string | null
    memory?: StringNullableFilter<"Profiling"> | string | null
    total_cpu_used?: StringNullableFilter<"Profiling"> | string | null
    total_memory_used?: StringNullableFilter<"Profiling"> | string | null
    raw_cpu_log?: StringNullableFilter<"Profiling"> | string | null
    raw_memory_log?: StringNullableFilter<"Profiling"> | string | null
    timestamp?: DateTimeFilter<"Profiling"> | Date | string
    createdAt?: DateTimeFilter<"Profiling"> | Date | string
    updatedAt?: DateTimeFilter<"Profiling"> | Date | string
  }

  export type BuildUpsertWithoutSessionsInput = {
    update: XOR<BuildUpdateWithoutSessionsInput, BuildUncheckedUpdateWithoutSessionsInput>
    create: XOR<BuildCreateWithoutSessionsInput, BuildUncheckedCreateWithoutSessionsInput>
    where?: BuildWhereInput
  }

  export type BuildUpdateToOneWithWhereWithoutSessionsInput = {
    where?: BuildWhereInput
    data: XOR<BuildUpdateWithoutSessionsInput, BuildUncheckedUpdateWithoutSessionsInput>
  }

  export type BuildUpdateWithoutSessionsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type BuildUncheckedUpdateWithoutSessionsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type SessionLogUpsertWithWhereUniqueWithoutSessionInput = {
    where: SessionLogWhereUniqueInput
    update: XOR<SessionLogUpdateWithoutSessionInput, SessionLogUncheckedUpdateWithoutSessionInput>
    create: XOR<SessionLogCreateWithoutSessionInput, SessionLogUncheckedCreateWithoutSessionInput>
  }

  export type SessionLogUpdateWithWhereUniqueWithoutSessionInput = {
    where: SessionLogWhereUniqueInput
    data: XOR<SessionLogUpdateWithoutSessionInput, SessionLogUncheckedUpdateWithoutSessionInput>
  }

  export type SessionLogUpdateManyWithWhereWithoutSessionInput = {
    where: SessionLogScalarWhereInput
    data: XOR<SessionLogUpdateManyMutationInput, SessionLogUncheckedUpdateManyWithoutSessionInput>
  }

  export type SessionLogScalarWhereInput = {
    AND?: SessionLogScalarWhereInput | SessionLogScalarWhereInput[]
    OR?: SessionLogScalarWhereInput[]
    NOT?: SessionLogScalarWhereInput | SessionLogScalarWhereInput[]
    id?: StringFilter<"SessionLog"> | string
    session_id?: StringFilter<"SessionLog"> | string
    command_name?: StringNullableFilter<"SessionLog"> | string | null
    url?: StringFilter<"SessionLog"> | string
    method?: StringFilter<"SessionLog"> | string
    title?: StringFilter<"SessionLog"> | string
    subtitle?: StringNullableFilter<"SessionLog"> | string | null
    body?: StringNullableFilter<"SessionLog"> | string | null
    response?: StringFilter<"SessionLog"> | string
    screenshot?: StringNullableFilter<"SessionLog"> | string | null
    is_success?: BoolNullableFilter<"SessionLog"> | boolean | null
    is_error?: BoolFilter<"SessionLog"> | boolean
    is_healed?: BoolFilter<"SessionLog"> | boolean
    original_selector?: StringNullableFilter<"SessionLog"> | string | null
    healed_selector?: StringNullableFilter<"SessionLog"> | string | null
    healing_confidence?: FloatNullableFilter<"SessionLog"> | number | null
    createdAt?: DateTimeFilter<"SessionLog"> | Date | string
    updatedAt?: DateTimeFilter<"SessionLog"> | Date | string
    duration?: IntNullableFilter<"SessionLog"> | number | null
    span_id?: StringNullableFilter<"SessionLog"> | string | null
    trace_id?: StringNullableFilter<"SessionLog"> | string | null
  }

  export type SessionCreateWithoutSessionLogInput = {
    id: string
    name?: string | null
    status?: string
    desired_capabilities: string
    session_capabilities: string
    node_id: string
    has_live_video: boolean
    video_recording_enabled?: boolean
    video_recording?: string | null
    startTime?: Date | string
    endTime?: Date | string | null
    failure_reason?: string | null
    is_profiling_available?: boolean
    device_info?: string | null
    device_udid: string
    device_platform: string
    device_version: string
    device_name?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    performance_trace?: string | null
    failure_category?: string | null
    ai_analysis?: string | null
    tags?: string | null
    trace_id?: string | null
    last_heartbeat_at?: Date | string | null
    heartbeat_pid?: number | null
    heartbeat_host?: string | null
    Log?: LogCreateNestedManyWithoutSessionInput
    Profiling?: ProfilingCreateNestedManyWithoutSessionInput
    build?: BuildCreateNestedOneWithoutSessionsInput
  }

  export type SessionUncheckedCreateWithoutSessionLogInput = {
    id: string
    build_id?: string | null
    name?: string | null
    status?: string
    desired_capabilities: string
    session_capabilities: string
    node_id: string
    has_live_video: boolean
    video_recording_enabled?: boolean
    video_recording?: string | null
    startTime?: Date | string
    endTime?: Date | string | null
    failure_reason?: string | null
    is_profiling_available?: boolean
    device_info?: string | null
    device_udid: string
    device_platform: string
    device_version: string
    device_name?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    performance_trace?: string | null
    failure_category?: string | null
    ai_analysis?: string | null
    tags?: string | null
    trace_id?: string | null
    last_heartbeat_at?: Date | string | null
    heartbeat_pid?: number | null
    heartbeat_host?: string | null
    Log?: LogUncheckedCreateNestedManyWithoutSessionInput
    Profiling?: ProfilingUncheckedCreateNestedManyWithoutSessionInput
  }

  export type SessionCreateOrConnectWithoutSessionLogInput = {
    where: SessionWhereUniqueInput
    create: XOR<SessionCreateWithoutSessionLogInput, SessionUncheckedCreateWithoutSessionLogInput>
  }

  export type SessionUpsertWithoutSessionLogInput = {
    update: XOR<SessionUpdateWithoutSessionLogInput, SessionUncheckedUpdateWithoutSessionLogInput>
    create: XOR<SessionCreateWithoutSessionLogInput, SessionUncheckedCreateWithoutSessionLogInput>
    where?: SessionWhereInput
  }

  export type SessionUpdateToOneWithWhereWithoutSessionLogInput = {
    where?: SessionWhereInput
    data: XOR<SessionUpdateWithoutSessionLogInput, SessionUncheckedUpdateWithoutSessionLogInput>
  }

  export type SessionUpdateWithoutSessionLogInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    status?: StringFieldUpdateOperationsInput | string
    desired_capabilities?: StringFieldUpdateOperationsInput | string
    session_capabilities?: StringFieldUpdateOperationsInput | string
    node_id?: StringFieldUpdateOperationsInput | string
    has_live_video?: BoolFieldUpdateOperationsInput | boolean
    video_recording_enabled?: BoolFieldUpdateOperationsInput | boolean
    video_recording?: NullableStringFieldUpdateOperationsInput | string | null
    startTime?: DateTimeFieldUpdateOperationsInput | Date | string
    endTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    failure_reason?: NullableStringFieldUpdateOperationsInput | string | null
    is_profiling_available?: BoolFieldUpdateOperationsInput | boolean
    device_info?: NullableStringFieldUpdateOperationsInput | string | null
    device_udid?: StringFieldUpdateOperationsInput | string
    device_platform?: StringFieldUpdateOperationsInput | string
    device_version?: StringFieldUpdateOperationsInput | string
    device_name?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    performance_trace?: NullableStringFieldUpdateOperationsInput | string | null
    failure_category?: NullableStringFieldUpdateOperationsInput | string | null
    ai_analysis?: NullableStringFieldUpdateOperationsInput | string | null
    tags?: NullableStringFieldUpdateOperationsInput | string | null
    trace_id?: NullableStringFieldUpdateOperationsInput | string | null
    last_heartbeat_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    heartbeat_pid?: NullableIntFieldUpdateOperationsInput | number | null
    heartbeat_host?: NullableStringFieldUpdateOperationsInput | string | null
    Log?: LogUpdateManyWithoutSessionNestedInput
    Profiling?: ProfilingUpdateManyWithoutSessionNestedInput
    build?: BuildUpdateOneWithoutSessionsNestedInput
  }

  export type SessionUncheckedUpdateWithoutSessionLogInput = {
    id?: StringFieldUpdateOperationsInput | string
    build_id?: NullableStringFieldUpdateOperationsInput | string | null
    name?: NullableStringFieldUpdateOperationsInput | string | null
    status?: StringFieldUpdateOperationsInput | string
    desired_capabilities?: StringFieldUpdateOperationsInput | string
    session_capabilities?: StringFieldUpdateOperationsInput | string
    node_id?: StringFieldUpdateOperationsInput | string
    has_live_video?: BoolFieldUpdateOperationsInput | boolean
    video_recording_enabled?: BoolFieldUpdateOperationsInput | boolean
    video_recording?: NullableStringFieldUpdateOperationsInput | string | null
    startTime?: DateTimeFieldUpdateOperationsInput | Date | string
    endTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    failure_reason?: NullableStringFieldUpdateOperationsInput | string | null
    is_profiling_available?: BoolFieldUpdateOperationsInput | boolean
    device_info?: NullableStringFieldUpdateOperationsInput | string | null
    device_udid?: StringFieldUpdateOperationsInput | string
    device_platform?: StringFieldUpdateOperationsInput | string
    device_version?: StringFieldUpdateOperationsInput | string
    device_name?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    performance_trace?: NullableStringFieldUpdateOperationsInput | string | null
    failure_category?: NullableStringFieldUpdateOperationsInput | string | null
    ai_analysis?: NullableStringFieldUpdateOperationsInput | string | null
    tags?: NullableStringFieldUpdateOperationsInput | string | null
    trace_id?: NullableStringFieldUpdateOperationsInput | string | null
    last_heartbeat_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    heartbeat_pid?: NullableIntFieldUpdateOperationsInput | number | null
    heartbeat_host?: NullableStringFieldUpdateOperationsInput | string | null
    Log?: LogUncheckedUpdateManyWithoutSessionNestedInput
    Profiling?: ProfilingUncheckedUpdateManyWithoutSessionNestedInput
  }

  export type SessionCreateWithoutLogInput = {
    id: string
    name?: string | null
    status?: string
    desired_capabilities: string
    session_capabilities: string
    node_id: string
    has_live_video: boolean
    video_recording_enabled?: boolean
    video_recording?: string | null
    startTime?: Date | string
    endTime?: Date | string | null
    failure_reason?: string | null
    is_profiling_available?: boolean
    device_info?: string | null
    device_udid: string
    device_platform: string
    device_version: string
    device_name?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    performance_trace?: string | null
    failure_category?: string | null
    ai_analysis?: string | null
    tags?: string | null
    trace_id?: string | null
    last_heartbeat_at?: Date | string | null
    heartbeat_pid?: number | null
    heartbeat_host?: string | null
    Profiling?: ProfilingCreateNestedManyWithoutSessionInput
    build?: BuildCreateNestedOneWithoutSessionsInput
    SessionLog?: SessionLogCreateNestedManyWithoutSessionInput
  }

  export type SessionUncheckedCreateWithoutLogInput = {
    id: string
    build_id?: string | null
    name?: string | null
    status?: string
    desired_capabilities: string
    session_capabilities: string
    node_id: string
    has_live_video: boolean
    video_recording_enabled?: boolean
    video_recording?: string | null
    startTime?: Date | string
    endTime?: Date | string | null
    failure_reason?: string | null
    is_profiling_available?: boolean
    device_info?: string | null
    device_udid: string
    device_platform: string
    device_version: string
    device_name?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    performance_trace?: string | null
    failure_category?: string | null
    ai_analysis?: string | null
    tags?: string | null
    trace_id?: string | null
    last_heartbeat_at?: Date | string | null
    heartbeat_pid?: number | null
    heartbeat_host?: string | null
    Profiling?: ProfilingUncheckedCreateNestedManyWithoutSessionInput
    SessionLog?: SessionLogUncheckedCreateNestedManyWithoutSessionInput
  }

  export type SessionCreateOrConnectWithoutLogInput = {
    where: SessionWhereUniqueInput
    create: XOR<SessionCreateWithoutLogInput, SessionUncheckedCreateWithoutLogInput>
  }

  export type SessionUpsertWithoutLogInput = {
    update: XOR<SessionUpdateWithoutLogInput, SessionUncheckedUpdateWithoutLogInput>
    create: XOR<SessionCreateWithoutLogInput, SessionUncheckedCreateWithoutLogInput>
    where?: SessionWhereInput
  }

  export type SessionUpdateToOneWithWhereWithoutLogInput = {
    where?: SessionWhereInput
    data: XOR<SessionUpdateWithoutLogInput, SessionUncheckedUpdateWithoutLogInput>
  }

  export type SessionUpdateWithoutLogInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    status?: StringFieldUpdateOperationsInput | string
    desired_capabilities?: StringFieldUpdateOperationsInput | string
    session_capabilities?: StringFieldUpdateOperationsInput | string
    node_id?: StringFieldUpdateOperationsInput | string
    has_live_video?: BoolFieldUpdateOperationsInput | boolean
    video_recording_enabled?: BoolFieldUpdateOperationsInput | boolean
    video_recording?: NullableStringFieldUpdateOperationsInput | string | null
    startTime?: DateTimeFieldUpdateOperationsInput | Date | string
    endTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    failure_reason?: NullableStringFieldUpdateOperationsInput | string | null
    is_profiling_available?: BoolFieldUpdateOperationsInput | boolean
    device_info?: NullableStringFieldUpdateOperationsInput | string | null
    device_udid?: StringFieldUpdateOperationsInput | string
    device_platform?: StringFieldUpdateOperationsInput | string
    device_version?: StringFieldUpdateOperationsInput | string
    device_name?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    performance_trace?: NullableStringFieldUpdateOperationsInput | string | null
    failure_category?: NullableStringFieldUpdateOperationsInput | string | null
    ai_analysis?: NullableStringFieldUpdateOperationsInput | string | null
    tags?: NullableStringFieldUpdateOperationsInput | string | null
    trace_id?: NullableStringFieldUpdateOperationsInput | string | null
    last_heartbeat_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    heartbeat_pid?: NullableIntFieldUpdateOperationsInput | number | null
    heartbeat_host?: NullableStringFieldUpdateOperationsInput | string | null
    Profiling?: ProfilingUpdateManyWithoutSessionNestedInput
    build?: BuildUpdateOneWithoutSessionsNestedInput
    SessionLog?: SessionLogUpdateManyWithoutSessionNestedInput
  }

  export type SessionUncheckedUpdateWithoutLogInput = {
    id?: StringFieldUpdateOperationsInput | string
    build_id?: NullableStringFieldUpdateOperationsInput | string | null
    name?: NullableStringFieldUpdateOperationsInput | string | null
    status?: StringFieldUpdateOperationsInput | string
    desired_capabilities?: StringFieldUpdateOperationsInput | string
    session_capabilities?: StringFieldUpdateOperationsInput | string
    node_id?: StringFieldUpdateOperationsInput | string
    has_live_video?: BoolFieldUpdateOperationsInput | boolean
    video_recording_enabled?: BoolFieldUpdateOperationsInput | boolean
    video_recording?: NullableStringFieldUpdateOperationsInput | string | null
    startTime?: DateTimeFieldUpdateOperationsInput | Date | string
    endTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    failure_reason?: NullableStringFieldUpdateOperationsInput | string | null
    is_profiling_available?: BoolFieldUpdateOperationsInput | boolean
    device_info?: NullableStringFieldUpdateOperationsInput | string | null
    device_udid?: StringFieldUpdateOperationsInput | string
    device_platform?: StringFieldUpdateOperationsInput | string
    device_version?: StringFieldUpdateOperationsInput | string
    device_name?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    performance_trace?: NullableStringFieldUpdateOperationsInput | string | null
    failure_category?: NullableStringFieldUpdateOperationsInput | string | null
    ai_analysis?: NullableStringFieldUpdateOperationsInput | string | null
    tags?: NullableStringFieldUpdateOperationsInput | string | null
    trace_id?: NullableStringFieldUpdateOperationsInput | string | null
    last_heartbeat_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    heartbeat_pid?: NullableIntFieldUpdateOperationsInput | number | null
    heartbeat_host?: NullableStringFieldUpdateOperationsInput | string | null
    Profiling?: ProfilingUncheckedUpdateManyWithoutSessionNestedInput
    SessionLog?: SessionLogUncheckedUpdateManyWithoutSessionNestedInput
  }

  export type SessionCreateWithoutProfilingInput = {
    id: string
    name?: string | null
    status?: string
    desired_capabilities: string
    session_capabilities: string
    node_id: string
    has_live_video: boolean
    video_recording_enabled?: boolean
    video_recording?: string | null
    startTime?: Date | string
    endTime?: Date | string | null
    failure_reason?: string | null
    is_profiling_available?: boolean
    device_info?: string | null
    device_udid: string
    device_platform: string
    device_version: string
    device_name?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    performance_trace?: string | null
    failure_category?: string | null
    ai_analysis?: string | null
    tags?: string | null
    trace_id?: string | null
    last_heartbeat_at?: Date | string | null
    heartbeat_pid?: number | null
    heartbeat_host?: string | null
    Log?: LogCreateNestedManyWithoutSessionInput
    build?: BuildCreateNestedOneWithoutSessionsInput
    SessionLog?: SessionLogCreateNestedManyWithoutSessionInput
  }

  export type SessionUncheckedCreateWithoutProfilingInput = {
    id: string
    build_id?: string | null
    name?: string | null
    status?: string
    desired_capabilities: string
    session_capabilities: string
    node_id: string
    has_live_video: boolean
    video_recording_enabled?: boolean
    video_recording?: string | null
    startTime?: Date | string
    endTime?: Date | string | null
    failure_reason?: string | null
    is_profiling_available?: boolean
    device_info?: string | null
    device_udid: string
    device_platform: string
    device_version: string
    device_name?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    performance_trace?: string | null
    failure_category?: string | null
    ai_analysis?: string | null
    tags?: string | null
    trace_id?: string | null
    last_heartbeat_at?: Date | string | null
    heartbeat_pid?: number | null
    heartbeat_host?: string | null
    Log?: LogUncheckedCreateNestedManyWithoutSessionInput
    SessionLog?: SessionLogUncheckedCreateNestedManyWithoutSessionInput
  }

  export type SessionCreateOrConnectWithoutProfilingInput = {
    where: SessionWhereUniqueInput
    create: XOR<SessionCreateWithoutProfilingInput, SessionUncheckedCreateWithoutProfilingInput>
  }

  export type SessionUpsertWithoutProfilingInput = {
    update: XOR<SessionUpdateWithoutProfilingInput, SessionUncheckedUpdateWithoutProfilingInput>
    create: XOR<SessionCreateWithoutProfilingInput, SessionUncheckedCreateWithoutProfilingInput>
    where?: SessionWhereInput
  }

  export type SessionUpdateToOneWithWhereWithoutProfilingInput = {
    where?: SessionWhereInput
    data: XOR<SessionUpdateWithoutProfilingInput, SessionUncheckedUpdateWithoutProfilingInput>
  }

  export type SessionUpdateWithoutProfilingInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    status?: StringFieldUpdateOperationsInput | string
    desired_capabilities?: StringFieldUpdateOperationsInput | string
    session_capabilities?: StringFieldUpdateOperationsInput | string
    node_id?: StringFieldUpdateOperationsInput | string
    has_live_video?: BoolFieldUpdateOperationsInput | boolean
    video_recording_enabled?: BoolFieldUpdateOperationsInput | boolean
    video_recording?: NullableStringFieldUpdateOperationsInput | string | null
    startTime?: DateTimeFieldUpdateOperationsInput | Date | string
    endTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    failure_reason?: NullableStringFieldUpdateOperationsInput | string | null
    is_profiling_available?: BoolFieldUpdateOperationsInput | boolean
    device_info?: NullableStringFieldUpdateOperationsInput | string | null
    device_udid?: StringFieldUpdateOperationsInput | string
    device_platform?: StringFieldUpdateOperationsInput | string
    device_version?: StringFieldUpdateOperationsInput | string
    device_name?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    performance_trace?: NullableStringFieldUpdateOperationsInput | string | null
    failure_category?: NullableStringFieldUpdateOperationsInput | string | null
    ai_analysis?: NullableStringFieldUpdateOperationsInput | string | null
    tags?: NullableStringFieldUpdateOperationsInput | string | null
    trace_id?: NullableStringFieldUpdateOperationsInput | string | null
    last_heartbeat_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    heartbeat_pid?: NullableIntFieldUpdateOperationsInput | number | null
    heartbeat_host?: NullableStringFieldUpdateOperationsInput | string | null
    Log?: LogUpdateManyWithoutSessionNestedInput
    build?: BuildUpdateOneWithoutSessionsNestedInput
    SessionLog?: SessionLogUpdateManyWithoutSessionNestedInput
  }

  export type SessionUncheckedUpdateWithoutProfilingInput = {
    id?: StringFieldUpdateOperationsInput | string
    build_id?: NullableStringFieldUpdateOperationsInput | string | null
    name?: NullableStringFieldUpdateOperationsInput | string | null
    status?: StringFieldUpdateOperationsInput | string
    desired_capabilities?: StringFieldUpdateOperationsInput | string
    session_capabilities?: StringFieldUpdateOperationsInput | string
    node_id?: StringFieldUpdateOperationsInput | string
    has_live_video?: BoolFieldUpdateOperationsInput | boolean
    video_recording_enabled?: BoolFieldUpdateOperationsInput | boolean
    video_recording?: NullableStringFieldUpdateOperationsInput | string | null
    startTime?: DateTimeFieldUpdateOperationsInput | Date | string
    endTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    failure_reason?: NullableStringFieldUpdateOperationsInput | string | null
    is_profiling_available?: BoolFieldUpdateOperationsInput | boolean
    device_info?: NullableStringFieldUpdateOperationsInput | string | null
    device_udid?: StringFieldUpdateOperationsInput | string
    device_platform?: StringFieldUpdateOperationsInput | string
    device_version?: StringFieldUpdateOperationsInput | string
    device_name?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    performance_trace?: NullableStringFieldUpdateOperationsInput | string | null
    failure_category?: NullableStringFieldUpdateOperationsInput | string | null
    ai_analysis?: NullableStringFieldUpdateOperationsInput | string | null
    tags?: NullableStringFieldUpdateOperationsInput | string | null
    trace_id?: NullableStringFieldUpdateOperationsInput | string | null
    last_heartbeat_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    heartbeat_pid?: NullableIntFieldUpdateOperationsInput | number | null
    heartbeat_host?: NullableStringFieldUpdateOperationsInput | string | null
    Log?: LogUncheckedUpdateManyWithoutSessionNestedInput
    SessionLog?: SessionLogUncheckedUpdateManyWithoutSessionNestedInput
  }

  export type SessionCreateManyBuildInput = {
    id: string
    name?: string | null
    status?: string
    desired_capabilities: string
    session_capabilities: string
    node_id: string
    has_live_video: boolean
    video_recording_enabled?: boolean
    video_recording?: string | null
    startTime?: Date | string
    endTime?: Date | string | null
    failure_reason?: string | null
    is_profiling_available?: boolean
    device_info?: string | null
    device_udid: string
    device_platform: string
    device_version: string
    device_name?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    performance_trace?: string | null
    failure_category?: string | null
    ai_analysis?: string | null
    tags?: string | null
    trace_id?: string | null
    last_heartbeat_at?: Date | string | null
    heartbeat_pid?: number | null
    heartbeat_host?: string | null
  }

  export type SessionUpdateWithoutBuildInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    status?: StringFieldUpdateOperationsInput | string
    desired_capabilities?: StringFieldUpdateOperationsInput | string
    session_capabilities?: StringFieldUpdateOperationsInput | string
    node_id?: StringFieldUpdateOperationsInput | string
    has_live_video?: BoolFieldUpdateOperationsInput | boolean
    video_recording_enabled?: BoolFieldUpdateOperationsInput | boolean
    video_recording?: NullableStringFieldUpdateOperationsInput | string | null
    startTime?: DateTimeFieldUpdateOperationsInput | Date | string
    endTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    failure_reason?: NullableStringFieldUpdateOperationsInput | string | null
    is_profiling_available?: BoolFieldUpdateOperationsInput | boolean
    device_info?: NullableStringFieldUpdateOperationsInput | string | null
    device_udid?: StringFieldUpdateOperationsInput | string
    device_platform?: StringFieldUpdateOperationsInput | string
    device_version?: StringFieldUpdateOperationsInput | string
    device_name?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    performance_trace?: NullableStringFieldUpdateOperationsInput | string | null
    failure_category?: NullableStringFieldUpdateOperationsInput | string | null
    ai_analysis?: NullableStringFieldUpdateOperationsInput | string | null
    tags?: NullableStringFieldUpdateOperationsInput | string | null
    trace_id?: NullableStringFieldUpdateOperationsInput | string | null
    last_heartbeat_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    heartbeat_pid?: NullableIntFieldUpdateOperationsInput | number | null
    heartbeat_host?: NullableStringFieldUpdateOperationsInput | string | null
    Log?: LogUpdateManyWithoutSessionNestedInput
    Profiling?: ProfilingUpdateManyWithoutSessionNestedInput
    SessionLog?: SessionLogUpdateManyWithoutSessionNestedInput
  }

  export type SessionUncheckedUpdateWithoutBuildInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    status?: StringFieldUpdateOperationsInput | string
    desired_capabilities?: StringFieldUpdateOperationsInput | string
    session_capabilities?: StringFieldUpdateOperationsInput | string
    node_id?: StringFieldUpdateOperationsInput | string
    has_live_video?: BoolFieldUpdateOperationsInput | boolean
    video_recording_enabled?: BoolFieldUpdateOperationsInput | boolean
    video_recording?: NullableStringFieldUpdateOperationsInput | string | null
    startTime?: DateTimeFieldUpdateOperationsInput | Date | string
    endTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    failure_reason?: NullableStringFieldUpdateOperationsInput | string | null
    is_profiling_available?: BoolFieldUpdateOperationsInput | boolean
    device_info?: NullableStringFieldUpdateOperationsInput | string | null
    device_udid?: StringFieldUpdateOperationsInput | string
    device_platform?: StringFieldUpdateOperationsInput | string
    device_version?: StringFieldUpdateOperationsInput | string
    device_name?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    performance_trace?: NullableStringFieldUpdateOperationsInput | string | null
    failure_category?: NullableStringFieldUpdateOperationsInput | string | null
    ai_analysis?: NullableStringFieldUpdateOperationsInput | string | null
    tags?: NullableStringFieldUpdateOperationsInput | string | null
    trace_id?: NullableStringFieldUpdateOperationsInput | string | null
    last_heartbeat_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    heartbeat_pid?: NullableIntFieldUpdateOperationsInput | number | null
    heartbeat_host?: NullableStringFieldUpdateOperationsInput | string | null
    Log?: LogUncheckedUpdateManyWithoutSessionNestedInput
    Profiling?: ProfilingUncheckedUpdateManyWithoutSessionNestedInput
    SessionLog?: SessionLogUncheckedUpdateManyWithoutSessionNestedInput
  }

  export type SessionUncheckedUpdateManyWithoutBuildInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    status?: StringFieldUpdateOperationsInput | string
    desired_capabilities?: StringFieldUpdateOperationsInput | string
    session_capabilities?: StringFieldUpdateOperationsInput | string
    node_id?: StringFieldUpdateOperationsInput | string
    has_live_video?: BoolFieldUpdateOperationsInput | boolean
    video_recording_enabled?: BoolFieldUpdateOperationsInput | boolean
    video_recording?: NullableStringFieldUpdateOperationsInput | string | null
    startTime?: DateTimeFieldUpdateOperationsInput | Date | string
    endTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    failure_reason?: NullableStringFieldUpdateOperationsInput | string | null
    is_profiling_available?: BoolFieldUpdateOperationsInput | boolean
    device_info?: NullableStringFieldUpdateOperationsInput | string | null
    device_udid?: StringFieldUpdateOperationsInput | string
    device_platform?: StringFieldUpdateOperationsInput | string
    device_version?: StringFieldUpdateOperationsInput | string
    device_name?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    performance_trace?: NullableStringFieldUpdateOperationsInput | string | null
    failure_category?: NullableStringFieldUpdateOperationsInput | string | null
    ai_analysis?: NullableStringFieldUpdateOperationsInput | string | null
    tags?: NullableStringFieldUpdateOperationsInput | string | null
    trace_id?: NullableStringFieldUpdateOperationsInput | string | null
    last_heartbeat_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    heartbeat_pid?: NullableIntFieldUpdateOperationsInput | number | null
    heartbeat_host?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type LogCreateManySessionInput = {
    id?: string
    log_type: string
    message: string
    timestamp?: Date | string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type ProfilingCreateManySessionInput = {
    id?: number
    cpu?: string | null
    memory?: string | null
    total_cpu_used?: string | null
    total_memory_used?: string | null
    raw_cpu_log?: string | null
    raw_memory_log?: string | null
    timestamp: Date | string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type SessionLogCreateManySessionInput = {
    id?: string
    command_name?: string | null
    url: string
    method: string
    title: string
    subtitle?: string | null
    body?: string | null
    response: string
    screenshot?: string | null
    is_success?: boolean | null
    is_error?: boolean
    is_healed?: boolean
    original_selector?: string | null
    healed_selector?: string | null
    healing_confidence?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
    duration?: number | null
    span_id?: string | null
    trace_id?: string | null
  }

  export type LogUpdateWithoutSessionInput = {
    id?: StringFieldUpdateOperationsInput | string
    log_type?: StringFieldUpdateOperationsInput | string
    message?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type LogUncheckedUpdateWithoutSessionInput = {
    id?: StringFieldUpdateOperationsInput | string
    log_type?: StringFieldUpdateOperationsInput | string
    message?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type LogUncheckedUpdateManyWithoutSessionInput = {
    id?: StringFieldUpdateOperationsInput | string
    log_type?: StringFieldUpdateOperationsInput | string
    message?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ProfilingUpdateWithoutSessionInput = {
    cpu?: NullableStringFieldUpdateOperationsInput | string | null
    memory?: NullableStringFieldUpdateOperationsInput | string | null
    total_cpu_used?: NullableStringFieldUpdateOperationsInput | string | null
    total_memory_used?: NullableStringFieldUpdateOperationsInput | string | null
    raw_cpu_log?: NullableStringFieldUpdateOperationsInput | string | null
    raw_memory_log?: NullableStringFieldUpdateOperationsInput | string | null
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ProfilingUncheckedUpdateWithoutSessionInput = {
    id?: IntFieldUpdateOperationsInput | number
    cpu?: NullableStringFieldUpdateOperationsInput | string | null
    memory?: NullableStringFieldUpdateOperationsInput | string | null
    total_cpu_used?: NullableStringFieldUpdateOperationsInput | string | null
    total_memory_used?: NullableStringFieldUpdateOperationsInput | string | null
    raw_cpu_log?: NullableStringFieldUpdateOperationsInput | string | null
    raw_memory_log?: NullableStringFieldUpdateOperationsInput | string | null
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ProfilingUncheckedUpdateManyWithoutSessionInput = {
    id?: IntFieldUpdateOperationsInput | number
    cpu?: NullableStringFieldUpdateOperationsInput | string | null
    memory?: NullableStringFieldUpdateOperationsInput | string | null
    total_cpu_used?: NullableStringFieldUpdateOperationsInput | string | null
    total_memory_used?: NullableStringFieldUpdateOperationsInput | string | null
    raw_cpu_log?: NullableStringFieldUpdateOperationsInput | string | null
    raw_memory_log?: NullableStringFieldUpdateOperationsInput | string | null
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type SessionLogUpdateWithoutSessionInput = {
    id?: StringFieldUpdateOperationsInput | string
    command_name?: NullableStringFieldUpdateOperationsInput | string | null
    url?: StringFieldUpdateOperationsInput | string
    method?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    subtitle?: NullableStringFieldUpdateOperationsInput | string | null
    body?: NullableStringFieldUpdateOperationsInput | string | null
    response?: StringFieldUpdateOperationsInput | string
    screenshot?: NullableStringFieldUpdateOperationsInput | string | null
    is_success?: NullableBoolFieldUpdateOperationsInput | boolean | null
    is_error?: BoolFieldUpdateOperationsInput | boolean
    is_healed?: BoolFieldUpdateOperationsInput | boolean
    original_selector?: NullableStringFieldUpdateOperationsInput | string | null
    healed_selector?: NullableStringFieldUpdateOperationsInput | string | null
    healing_confidence?: NullableFloatFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    span_id?: NullableStringFieldUpdateOperationsInput | string | null
    trace_id?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type SessionLogUncheckedUpdateWithoutSessionInput = {
    id?: StringFieldUpdateOperationsInput | string
    command_name?: NullableStringFieldUpdateOperationsInput | string | null
    url?: StringFieldUpdateOperationsInput | string
    method?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    subtitle?: NullableStringFieldUpdateOperationsInput | string | null
    body?: NullableStringFieldUpdateOperationsInput | string | null
    response?: StringFieldUpdateOperationsInput | string
    screenshot?: NullableStringFieldUpdateOperationsInput | string | null
    is_success?: NullableBoolFieldUpdateOperationsInput | boolean | null
    is_error?: BoolFieldUpdateOperationsInput | boolean
    is_healed?: BoolFieldUpdateOperationsInput | boolean
    original_selector?: NullableStringFieldUpdateOperationsInput | string | null
    healed_selector?: NullableStringFieldUpdateOperationsInput | string | null
    healing_confidence?: NullableFloatFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    span_id?: NullableStringFieldUpdateOperationsInput | string | null
    trace_id?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type SessionLogUncheckedUpdateManyWithoutSessionInput = {
    id?: StringFieldUpdateOperationsInput | string
    command_name?: NullableStringFieldUpdateOperationsInput | string | null
    url?: StringFieldUpdateOperationsInput | string
    method?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    subtitle?: NullableStringFieldUpdateOperationsInput | string | null
    body?: NullableStringFieldUpdateOperationsInput | string | null
    response?: StringFieldUpdateOperationsInput | string
    screenshot?: NullableStringFieldUpdateOperationsInput | string | null
    is_success?: NullableBoolFieldUpdateOperationsInput | boolean | null
    is_error?: BoolFieldUpdateOperationsInput | boolean
    is_healed?: BoolFieldUpdateOperationsInput | boolean
    original_selector?: NullableStringFieldUpdateOperationsInput | string | null
    healed_selector?: NullableStringFieldUpdateOperationsInput | string | null
    healing_confidence?: NullableFloatFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    span_id?: NullableStringFieldUpdateOperationsInput | string | null
    trace_id?: NullableStringFieldUpdateOperationsInput | string | null
  }



  /**
   * Aliases for legacy arg types
   */
    /**
     * @deprecated Use BuildCountOutputTypeDefaultArgs instead
     */
    export type BuildCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = BuildCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use SessionCountOutputTypeDefaultArgs instead
     */
    export type SessionCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = SessionCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use BuildDefaultArgs instead
     */
    export type BuildArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = BuildDefaultArgs<ExtArgs>
    /**
     * @deprecated Use SessionDefaultArgs instead
     */
    export type SessionArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = SessionDefaultArgs<ExtArgs>
    /**
     * @deprecated Use SessionLogDefaultArgs instead
     */
    export type SessionLogArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = SessionLogDefaultArgs<ExtArgs>
    /**
     * @deprecated Use LogDefaultArgs instead
     */
    export type LogArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = LogDefaultArgs<ExtArgs>
    /**
     * @deprecated Use ProfilingDefaultArgs instead
     */
    export type ProfilingArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = ProfilingDefaultArgs<ExtArgs>
    /**
     * @deprecated Use AppDefaultArgs instead
     */
    export type AppArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = AppDefaultArgs<ExtArgs>
    /**
     * @deprecated Use DeviceDefaultArgs instead
     */
    export type DeviceArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = DeviceDefaultArgs<ExtArgs>
    /**
     * @deprecated Use PendingSessionDefaultArgs instead
     */
    export type PendingSessionArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = PendingSessionDefaultArgs<ExtArgs>
    /**
     * @deprecated Use CLIArgsDefaultArgs instead
     */
    export type CLIArgsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = CLIArgsDefaultArgs<ExtArgs>
    /**
     * @deprecated Use WebhookConfigDefaultArgs instead
     */
    export type WebhookConfigArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = WebhookConfigDefaultArgs<ExtArgs>
    /**
     * @deprecated Use WebConfigDefaultArgs instead
     */
    export type WebConfigArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = WebConfigDefaultArgs<ExtArgs>
    /**
     * @deprecated Use LocatorEtalonDefaultArgs instead
     */
    export type LocatorEtalonArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = LocatorEtalonDefaultArgs<ExtArgs>

  /**
   * Batch Payload for updateMany & deleteMany & createMany
   */

  export type BatchPayload = {
    count: number
  }

  /**
   * DMMF
   */
  export const dmmf: runtime.BaseDMMF
}