export enum HealingTier {
  TIER_1_RECOVERY = 0,
  TIER_1_NATIVE = 1,
  TIER_2_FUZZY_XML = 2,
  TIER_3_LOCAL_OCR = 3,
  TIER_4_VISUAL_AI = 4,
  TIER_5_LLM_REASONING = 5,
}

export interface HealedElement {
  id: string; // W3C element object / internal ID
  tier: HealingTier;
  confidence: number;
  originalSelector: string;
  recommendedSelector: string;
  candidateSelectors?: string[]; // Multiple strategies from best to worst
  message?: string;
  rect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  node?: any; // Optional raw node information for learning
}

export interface HealingContext {
  sessionId: string;
  driver: any;
  strategy: string;
  selector: string;
  pageSource?: string;
  screenshotBase64?: string;
}

export interface HealingProvider {
  name: string;
  tier: HealingTier;
  heal(context: HealingContext): Promise<HealedElement | null>;
}
