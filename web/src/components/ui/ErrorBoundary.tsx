import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
    children?: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Uncaught error:', error, errorInfo);
    }

    private handleReset = () => {
        this.setState({ hasError: false });
        window.location.reload();
    };

    public render() {
        if (this.state.hasError) {
            return (
                this.props.fallback || (
                    <div className="error-boundary-container" style={{
                        padding: '4rem 2rem',
                        textAlign: 'center',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '1.5rem',
                        color: 'var(--text-main)',
                        background: 'var(--bg-main)',
                        minHeight: '100vh'
                    }}>
                        <div style={{ color: 'var(--accent-red)', filter: 'drop-shadow(0 0 10px rgba(239, 68, 68, 0.3))' }}>
                            <AlertTriangle size={64} />
                        </div>
                        <h2 style={{ fontSize: '2rem', fontWeight: 700, margin: 0 }}>Component Exception Detected</h2>
                        <p style={{ color: 'var(--text-muted)', maxWidth: '500px', lineHeight: 1.6 }}>
                            An unexpected error occurred while rendering this section. Xenon's isolation engine has contained the fault to prevent a total system crash.
                        </p>
                        {this.state.error && (
                            <pre style={{
                                background: 'rgba(0,0,0,0.3)',
                                padding: '1rem',
                                borderRadius: '8px',
                                fontSize: '0.8rem',
                                color: 'var(--accent-red)',
                                maxWidth: '80%',
                                overflowX: 'auto'
                            }}>
                                {this.state.error.message}
                            </pre>
                        )}
                        <button
                            onClick={this.handleReset}
                            style={{
                                background: 'var(--primary)',
                                color: 'var(--secondary)',
                                border: 'none',
                                padding: '0.75rem 2rem',
                                borderRadius: '8px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                transition: 'all 0.2s'
                            }}
                            onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                            onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                        >
                            <RefreshCw size={18} />
                            Reload Application
                        </button>
                    </div>
                )
            );
        }

        return this.props.children;
    }
}
