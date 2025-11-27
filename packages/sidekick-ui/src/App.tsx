
function App() {
    return (
        <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center">
            <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-8">
                <h1 className="text-2xl font-bold text-gray-900 mb-4">Sidekick Monitoring</h1>
                <p className="text-gray-600">
                    Welcome to the Sidekick Monitoring UI. This is the initial shell.
                </p>
                <div className="mt-6 flex gap-2">
                    <button className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors">
                        Start Session
                    </button>
                    <button className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 transition-colors">
                        View Logs
                    </button>
                </div>
            </div>
        </div>
    );
}

export default App;
