import React, { useEffect, useState } from 'react';
import useStore from '../lib/store';
import { setActiveCustomAgent, setActiveModelUrl } from '../lib/actions';

const AgentSelector: React.FC = () => {
  const customAgents = useStore.use.customAgents();
  const setCustomAgents = useStore.use.setCustomAgents();
  const activeCustomAgent = useStore.use.activeCustomAgent();
  const models = useStore.use.models();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAgents = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/agents/list');
        if (!response.ok) {
          throw new Error(`Failed to fetch agents: ${response.statusText}`);
        }
        const agents = await response.json();
        if (agents.error) {
          throw new Error(agents.error);
        }
        setCustomAgents(agents);
      } catch (error: any) {
        console.error("Failed to fetch custom agents:", error);
        setError("Error loading agents");
      } finally {
        setIsLoading(false);
      }
    };

    fetchAgents();
  }, [setCustomAgents]);

  const handleAgentChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const agentId = event.target.value;
    if (agentId === "default") {
        const defaultAgent = models.find(m => m.name === 'Frankenstein');
        if (defaultAgent) {
            setActiveModelUrl(defaultAgent);
        }
    } else {
      const selectedAgent = customAgents.find(agent => agent._id === agentId);
      if (selectedAgent) {
        setActiveCustomAgent(selectedAgent);
      }
    }
  };

  const truncateAddress = (address: string) => {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  }

  if (error) {
    return (
      <select className="agent-selector" disabled title={error}>
        <option>{error}</option>
      </select>
    );
  }

  if (isLoading) {
    return (
      <select className="agent-selector" disabled>
        <option>Loading Agents...</option>
      </select>
    );
  }

  return (
    <div className="relative">
      <select
        value={activeCustomAgent?._id || "default"}
        onChange={handleAgentChange}
        className="agent-selector"
        title="Discover user-created AI agents"
      >
        <option value="default">Discover...</option>
        {customAgents.map(agent => (
          <option key={agent._id} value={agent._id} title={agent.description}>
            {agent.name} ({truncateAddress(agent.creatorWalletAddress)})
          </option>
        ))}
      </select>
    </div>
  );
};

export default AgentSelector;