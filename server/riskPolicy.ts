export type DeterministicRiskSignals = {
  categories: string[];
  highRiskCategories: string[];
  approvalIntentCategories: string[];
  uncertainty: boolean;
  requiresApproval: boolean;
};

const highRiskRules = [
  { category: "LEGAL", terms: ["lawyer", "lawsuit", "court", "legal", "liable", "liability", "settlement", "saman", "律师", "法庭", "法律", "赔偿"] },
  { category: "FINANCIAL", terms: ["transfer", "bank in", "pay you", "refund", "loan", "debt", "investment", "wallet", "duit", "钱", "借钱", "还钱", "转账", "投资"] },
  { category: "SECURITY_ACCESS", terms: ["password", "otp", "code", "access", "login", "key", "security", "account", "密码", "验证码", "权限", "账号"] },
  { category: "MEDICAL", terms: ["diagnosis", "medicine", "medication", "doctor said", "medical", "hospital", "药", "医生", "诊断", "医院"] },
  { category: "CONFIDENTIAL", terms: ["secret", "confidential", "private", "leak", "don't tell", "机密", "秘密", "不要告诉"] },
  { category: "RELATIONSHIP_COMMITMENT", terms: ["break up", "separate", "marry", "relationship", "reconcile", "move in", "分手", "结婚", "复合", "关系"] },
  { category: "AUTHORIZATION", terms: ["approve", "authorize", "permission", "terminate", "ban", "revoke", "批准", "授权", "开除", "封锁"] },
];

const approvalIntentRules = [
  { category: "ENQUIRY", terms: ["how much", "price", "quotation", "quote", "can you", "could you", "may i", "boleh", "berapa", "多少钱", "可以吗", "请问", "什么", "怎么", "几时", "哪里"] },
  { category: "TASK_REQUEST", terms: ["please send", "please arrange", "please book", "please help", "can you send", "can you arrange", "can you book", "帮我", "安排", "处理", "发给我", "订"] },
  { category: "APPROVAL_OR_DECISION", terms: ["approve", "approval", "decide", "decision", "confirm", "confirming", "agree", "accept", "批准", "决定", "确认", "同意"] },
];

const uncertainTerms = ["where are you", "when are you coming", "are you free", "can you promise", "you said", "what do you feel", "你在哪里", "你几点来", "你有空吗", "你答应", "你怎么想"];

function matchingCategories(message: string, rules: Array<{ category: string; terms: string[] }>) {
  return rules.filter(rule => rule.terms.some(term => message.includes(term.toLowerCase()))).map(rule => rule.category);
}

export function findDeterministicRiskSignals(message: string): DeterministicRiskSignals {
  const normalized = message.toLowerCase();
  const highRiskCategories = matchingCategories(normalized, highRiskRules);
  const approvalIntentCategories = matchingCategories(normalized, approvalIntentRules);
  const uncertainty = uncertainTerms.some(term => normalized.includes(term.toLowerCase()));
  return {
    categories: [...highRiskCategories, ...approvalIntentCategories],
    highRiskCategories,
    approvalIntentCategories,
    uncertainty,
    requiresApproval: highRiskCategories.length > 0 || approvalIntentCategories.length > 0 || uncertainty,
  };
}
