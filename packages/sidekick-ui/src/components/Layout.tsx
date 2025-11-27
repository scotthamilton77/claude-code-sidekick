import React from 'react';

interface LayoutProps {
    header: React.ReactNode;
    timeline: React.ReactNode;
    transcript: React.ReactNode;
    inspector: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ header, timeline, transcript, inspector }) => {
    return (
        <div className="h-screen bg-slate-50 flex flex-col font-sans">
            {header}
            <div className="flex-1 flex overflow-hidden">
                {timeline}
                {transcript}
                {inspector}
            </div>
        </div>
    );
};

export default Layout;
