import React, { useState } from 'react';
import {
  Code,
  Trash2,
  Download,
  Copy,
  Check,
  Plus,
  Terminal,
  ChevronDown,
  FileCode,
} from 'lucide-react';
import { Badge } from '../ui/badge';
import { Select } from '../ui/select';

export interface PomElement {
  id: string;
  name: string;
  locator: string;
  strategy: string;
  type: string;
}

interface PomWorkbenchProps {
  elements: PomElement[];
  onRemoveElement: (id: string) => void;
  onClearAll: () => void;
  platform: string;
}

const PomWorkbench: React.FC<PomWorkbenchProps> = ({
  elements,
  onRemoveElement,
  onClearAll,
  platform,
}) => {
  const [language, setLanguage] = useState<'typescript' | 'java' | 'python'>('typescript');
  const [pageName, setPageName] = useState('MyPage');
  const [copied, setCopied] = useState(false);

  const generateCode = () => {
    if (language === 'typescript') {
      return `import { AppiumDriver } from 'xenon-client';

export class ${pageName} {
  constructor(private driver: AppiumDriver) {}

  ${elements
    .map(
      (el) => `/** ${el.type} detected via ${el.strategy} */
  private ${el.name} = () => this.driver.findElement('${el.strategy}', '${el.locator}');`,
    )
    .join('\n\n  ')}

  async tap${elements[0]?.name || 'Element'}() {
    await (await this.${elements[0]?.name || 'element'}()).click();
  }
}`;
    } else if (language === 'java') {
      return `public class ${pageName} {
    private AppiumDriver driver;

    public ${pageName}(AppiumDriver driver) {
        this.driver = driver;
    }

    ${elements
      .map(
        (el) => `@AndroidFindBy(${el.strategy} = "${el.locator}")
    private MobileElement ${el.name.toLowerCase()};`,
      )
      .join('\n\n    ')}
}`;
    }
    return `# Python Implementation
class ${pageName}:
    def __init__(self, driver):
        self.driver = driver

    ${elements
      .map(
        (el) => `def ${el.name.toLowerCase()}(self):
        return self.driver.find_element_by_${el.strategy.replace('-', '_')}("${el.locator}")`,
      )
      .join('\n\n    ')}
`;
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generateCode());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="pom-workbench">
      <div className="omni-ai-header" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Code size={14} />
          POM Workbench
        </div>
        <Badge variant="outline" className="enterprise-badge-green">
          {elements.length} Elements
        </Badge>
      </div>

      <div className="pom-config-row">
        <input
          className="pom-page-input"
          value={pageName}
          onChange={(e) => setPageName(e.target.value)}
          placeholder="Page Class Name"
        />
        <Select
          selectSize="sm"
          value={language}
          onChange={(e) => setLanguage(e.target.value as any)}
        >
          <option value="typescript">TypeScript</option>
          <option value="java">Java</option>
          <option value="python">Python</option>
        </Select>
      </div>

      <div className="pom-element-list">
        {elements.length === 0 ? (
          <div className="pom-empty-state">
            <Terminal size={32} style={{ opacity: 0.2, marginBottom: '12px' }} />
            <p>Add elements from the inspector to start building your class.</p>
          </div>
        ) : (
          elements.map((el) => (
            <div key={el.id} className="pom-element-item animate-fade-in">
              <div className="pom-item-info">
                <span className="pom-item-name">{el.name}</span>
                <span className="pom-item-meta">
                  {el.strategy}: {el.locator.substring(0, 20)}...
                </span>
              </div>
              <button className="pom-item-delete" onClick={() => onRemoveElement(el.id)}>
                <Trash2 size={12} />
              </button>
            </div>
          ))
        )}
      </div>

      {elements.length > 0 && (
        <div className="pom-actions">
          <button className="omni-copy-btn secondary-action" onClick={onClearAll}>
            <Trash2 size={14} /> Reset
          </button>
          <button className="omni-ai-btn" onClick={handleCopy}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy Class'}
          </button>
        </div>
      )}
    </div>
  );
};

export default PomWorkbench;
