import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { RunnableSequence } from '@langchain/core/runnables';
import { PromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents';

export class StatefulAIAgent implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Stateful AI Agent',
		name: 'statefulAgent',
		icon: 'file:statefulaiagent.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["userMessage"]}}',
		description: 'Advanced AI agent with state management and tool calling capabilities',
		defaults: {
			name: 'Stateful AI Agent',
		},
		inputs: [
			NodeConnectionTypes.Main,
			{
				type: NodeConnectionTypes.AiLanguageModel,
				displayName: 'LLM',
				required: true,
				maxConnections: 1,
			},
			{
				type: NodeConnectionTypes.AiTool,
				displayName: 'State',
				required: false,
				maxConnections: 1,
			},
			{
				type: NodeConnectionTypes.AiTool,
				displayName: 'Tools',
				maxConnections: undefined,
			},
		],
		outputs: [NodeConnectionTypes.Main],
		properties: [
			{
				displayName: 'User Message',
				name: 'userMessage',
				type: 'string',
				default: '',
				required: true,
				typeOptions: {
					rows: 4,
				},
				description: 'The message from the user that the agent should respond to',
			},
			{
				displayName: 'System Prompt',
				name: 'systemPrompt',
				type: 'string',
				default: "You're a helpful assistant",
				typeOptions: {
					rows: 6,
				},
				description: 'The system prompt that defines the agent\'s behavior and personality',
			},
			{
				displayName: 'State Model',
				name: 'stateModel',
				type: 'json',
				default: '',
				placeholder: '{\n  "field_name": "Description of what this field tracks"\n}',
				description: 'JSON object defining the state fields to track. Each key is a field name and value is its description.',
			},
			{
				displayName: 'Enable Conversation History',
				name: 'conversationHistory',
				type: 'boolean',
				default: false,
				description: 'Whether to track and maintain conversation history across interactions',
			},
			{
				displayName: 'Single Prompt State Tracking',
				name: 'singlePromptStateTracking',
				type: 'boolean',
				default: true,
				description: 'Whether to use single prompt mode (faster) or double prompt mode (more accurate state tracking)',
			},
		],
	};

	// Helper Methods (Static)
	static formatConversationHistory(history: Array<{ role: string; message: string }>): string {
		if (!Array.isArray(history) || history.length === 0) {
			return "No previous conversation.";
		}
		return history.map(entry => `${entry.role}: ${entry.message}`).join("\n");
	}

	static cleanJsonResponse(jsonString: string): string {
		let cleaned = jsonString.trim();
		if (cleaned.startsWith('```')) {
			cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '');
			cleaned = cleaned.replace(/\n?```\s*$/, '');
		}
		return cleaned.trim();
	}

	static prepareStateFieldsForTemplate(stateModel: Record<string, string>, state: Record<string, any>): Record<string, any> {
		const result: Record<string, any> = {};
		for (const key of Object.keys(stateModel)) {
			const value = (key in state) ? state[key] : null;
			result[key] = (value === null || value === undefined) ? "" : value;
		}
		return result;
	}

	static parseToolResult(toolResult: any): any {
		if (typeof toolResult !== 'string') {
			return toolResult;
		}
		try {
			return JSON.parse(toolResult);
		} catch (e) {
			return toolResult;
		}
	}

	static async invokeTools(
		toolsToInvoke: any[],
		agentTools: any[],
		stateModel: Record<string, string>,
		state: Record<string, any>,
		stateChangedProps: string[]
	): Promise<string[]> {
		const invokedToolNames: string[] = [];

		for (const toolInvocation of toolsToInvoke) {
			const { tool_name, reason, input_params, state_field } = toolInvocation;

			const tool = agentTools.find(t =>
				t.name === tool_name || t.name.toLowerCase() === tool_name.toLowerCase()
			);

			if (!tool) {
				continue;
			}

			try {
				const toolResult = await tool.invoke(input_params || {});

				let targetField = state_field;
				if (!targetField && (tool_name.toLowerCase().includes('steps') || reason?.toLowerCase().includes('steps'))) {
					targetField = 'task_steps';
				}

				if (targetField && targetField in stateModel) {
					const parsedResult = StatefulAIAgent.parseToolResult(toolResult);

					if (JSON.stringify(state[targetField]) !== JSON.stringify(parsedResult)) {
						state[targetField] = parsedResult;
						if (!stateChangedProps.includes(targetField)) {
							stateChangedProps.push(targetField);
						}
					}
				}

				invokedToolNames.push(tool_name);
			} catch (error) {
				// Tool invocation failed, continue with other tools
			}
		}

		return invokedToolNames;
	}

	static validateAndExtractState(
		parsedResult: any,
		stateModel: Record<string, string>,
		state: Record<string, any>,
		prevStateModelOnly: Record<string, any>,
		stateChangedProps: string[],
		isFirstRun: boolean
	): string[] {
		const newState = parsedResult.state || {};

		for (const key of Object.keys(stateModel)) {
			if (!(key in newState)) {
				newState[key] = null;
			}
			state[key] = newState[key];
		}

		const changedProps = Object.keys(stateModel).filter(key => {
			const prevValue = prevStateModelOnly[key];
			const newValue = state[key];
			return JSON.stringify(prevValue) !== JSON.stringify(newValue);
		});

		if (isFirstRun && changedProps.length === 0) {
			return Object.keys(stateModel);
		}

		return changedProps;
	}

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				// Get node parameters
				const userMessage = this.getNodeParameter('userMessage', itemIndex) as string;
				const systemPrompt = this.getNodeParameter('systemPrompt', itemIndex, "You're a helpful assistant") as string;
				const stateModelStr = this.getNodeParameter('stateModel', itemIndex, '') as string;
				const conversationHistory = this.getNodeParameter('conversationHistory', itemIndex, false) as boolean;
				const singlePromptStateTracking = this.getNodeParameter('singlePromptStateTracking', itemIndex, true) as boolean;

				// Parse state model
				let stateModel: Record<string, string> | null = null;
				if (stateModelStr && stateModelStr.trim()) {
					try {
						stateModel = JSON.parse(stateModelStr);
					} catch (error) {
						throw new NodeOperationError(this.getNode(), `Invalid State Model JSON: ${error.message}`, {
							itemIndex,
						});
					}
				}

				// Get AI connections (with maxConnections: 1, this returns a single object, not an array)
				const llm = (await this.getInputConnectionData(NodeConnectionTypes.AiLanguageModel, 0)) as any;
				if (!llm) {
					throw new NodeOperationError(this.getNode(), 'LLM is required but not connected', {
						itemIndex,
					});
				}

				// Get State from first AiTool connection (index 0)
				let stateManagementTool: any = null;
				try {
					const stateConnection = await this.getInputConnectionData(NodeConnectionTypes.AiTool, 0);
					if (stateConnection) {
						// If it's an array, take the first element, otherwise use as-is
						stateManagementTool = Array.isArray(stateConnection) ? stateConnection[0] : stateConnection;
					}
				} catch (error) {
					stateManagementTool = null;
				}

				// Get tools from second AiTool connection (index 1)
				let agentTools: any[] = [];
				try {
					const toolsConnection = await this.getInputConnectionData(NodeConnectionTypes.AiTool, 1);
					if (toolsConnection) {
						agentTools = Array.isArray(toolsConnection) ? toolsConnection : [toolsConnection];
					}
				} catch (error) {
					agentTools = [];
				}


				if (!userMessage) {
					throw new NodeOperationError(this.getNode(), 'User Message is required', {
						itemIndex,
					});
				}

				// Get Previous State
				let prevState: Record<string, any> = {};
				let state: Record<string, any> = {};
				let stateChangedProps: string[] = [];

				if (stateModel || conversationHistory) {
					if (!stateManagementTool) {
						throw new NodeOperationError(this.getNode(), 'State connection is required but not connected. Please connect a sub-workflow to the State input.', {
							itemIndex,
						});
					}

					const stateManagementResponse = await stateManagementTool.invoke({
						operation: "get",
						content: ""
					});

					const parsedResponse = JSON.parse(stateManagementResponse);
					const previousStateData = Array.isArray(parsedResponse) ? parsedResponse[0] : parsedResponse;
					prevState = previousStateData || {};
				}

				// Initialize conversation history
				let conversationHistoryValue: Array<{ role: string; message: string }> | null = null;
				if (conversationHistory) {
					conversationHistoryValue = prevState.conversation_history || [];
				}

				// Prepare State Model Data
				let response: string = '';
				let stateFieldDescriptions = "";
				let prevStateModelOnly: Record<string, any> = {};
				let isFirstRun = false;

				if (stateModel) {
					const prevStateHasFields = Object.keys(stateModel).some(key => key in prevState);
					isFirstRun = !prevStateHasFields;

					for (const key of Object.keys(stateModel)) {
						prevStateModelOnly[key] = (key in prevState) ? prevState[key] : null;
					}

					stateFieldDescriptions = Object.entries(stateModel)
						.map(([key, description]) => `- ${key}: ${description}`)
						.join("\n");
				}

				const availableToolsDesc = agentTools.length > 0
					? agentTools.map(tool => `- ${tool.name}: ${tool.description || 'No description available'}`).join("\n")
					: "No tools available";

				const useAgent = agentTools.length > 0;

				// ============================================
				// Execute Agent Logic
				// ============================================

				if (stateModel && singlePromptStateTracking) {
					// Single Request Mode
					const combinedPrompt = PromptTemplate.fromTemplate(`
${systemPrompt}

State Model (fields to track):
{stateFields}

Current State:
{currentState}

${useAgent ? `
Available Tools (you can request to use these if needed):
{availableTools}
` : ''}

${conversationHistory ? `
Previous Conversation:
{conversation_history}
` : ''}

User: {user_message}

Instructions:
1. Analyze the user message and update state fields based on the state model
2. For each field in the state model, determine its value from the user message or keep the previous value
3. ${useAgent ? 'If you need external data to populate state fields or answer the user, specify which tools to invoke' : 'Provide a helpful response'}
4. Provide a natural, helpful response to the user

Respond with ONLY a valid JSON object in the following format:
{{
  "state": {{
    // Complete state object with all fields from state model
  }},
  ${useAgent ? `"tools_to_invoke": [
    // Array of tool invocation objects, or empty array if no tools needed
    // Only request tools if you truly need external data
    {{
      "tool_name": "Tool Name",
      "reason": "Why this tool is needed",
      "state_field": "field_name",
      "input_params": {{}}
    }}
  ],` : ''}
  "response": "Your helpful and natural response to the user"
}}
`);

					const combinedChain = RunnableSequence.from([
						combinedPrompt,
						llm as any,
						new StringOutputParser(),
					]) as any;

					const stateFieldsForTemplate = StatefulAIAgent.prepareStateFieldsForTemplate(stateModel, prevStateModelOnly);

					const inputVariables: Record<string, any> = {
						user_message: userMessage,
						stateFields: stateFieldDescriptions,
						currentState: Object.keys(prevStateModelOnly).length > 0 ? JSON.stringify(prevStateModelOnly, null, 2) : "{}",
						...stateFieldsForTemplate
					};

					if (useAgent) {
						inputVariables.availableTools = availableToolsDesc;
					}

					if (conversationHistory && conversationHistoryValue) {
						inputVariables.conversation_history = StatefulAIAgent.formatConversationHistory(conversationHistoryValue);
					}

					const combinedResult = await combinedChain.invoke(inputVariables as any);

					let toolsToInvoke: any[] = [];
					try {
						const cleanedResult = StatefulAIAgent.cleanJsonResponse(combinedResult);
						const parsedResult = JSON.parse(cleanedResult);

						stateChangedProps = StatefulAIAgent.validateAndExtractState(
							parsedResult,
							stateModel,
							state,
							prevStateModelOnly,
							stateChangedProps,
							isFirstRun
						);

						response = parsedResult.response || "";

						if (useAgent) {
							toolsToInvoke = parsedResult.tools_to_invoke || [];

							if (!Array.isArray(toolsToInvoke)) {
								toolsToInvoke = [];
							}
						}

					} catch (error) {
						throw new Error(`Failed to parse combined JSON: ${error.message}`);
					}

					if (toolsToInvoke.length > 0) {
						const invokedToolNames = await StatefulAIAgent.invokeTools(toolsToInvoke, agentTools, stateModel, state, stateChangedProps);

						if (invokedToolNames.length > 0) {
							const refinementPrompt = PromptTemplate.fromTemplate(`
${systemPrompt}

Updated State (after tool invocations):
{updatedState}

${conversationHistory ? `
Previous Conversation:
{conversation_history}
` : ''}

User: {user_message}

The following tools were invoked to gather information:
{toolsInvoked}

Now provide a complete, natural response to the user based on the updated state and tool results.
Respond with ONLY the response text (not JSON).
`);

							const refinementChain = RunnableSequence.from([
								refinementPrompt,
								llm as any,
								new StringOutputParser(),
							]) as any;

							const toolsInvokedDesc = invokedToolNames
								.map((name, idx) => `${idx + 1}. ${name}`)
								.join('\n');

							const stateModelFields = StatefulAIAgent.prepareStateFieldsForTemplate(stateModel, state);

							const refinementInput: Record<string, any> = {
								user_message: userMessage,
								updatedState: JSON.stringify(state, null, 2),
								toolsInvoked: toolsInvokedDesc,
								...stateModelFields
							};

							if (conversationHistory && conversationHistoryValue) {
								refinementInput.conversation_history = StatefulAIAgent.formatConversationHistory(conversationHistoryValue);
							}

							response = await refinementChain.invoke(refinementInput as any);
						}
					}

				} else if (stateModel && !singlePromptStateTracking) {
					// Double Request Mode
					const stateAnalysisPrompt = PromptTemplate.fromTemplate(`
You are analyzing a user message to update the conversation state and determine which tools should be invoked.

State Model (fields to track):
{stateFields}

Current State:
{currentState}

${useAgent ? `
Available Tools (name and description):
{availableTools}
` : ''}

${conversationHistory ? `
Previous Conversation:
{conversation_history}
` : ''}

User Message: {userMessage}

Instructions:
1. Analyze the user message and determine the new state values based on the state model
2. For each field in the state model, determine its current value based on the user message and previous state
3. If a value hasn't changed or can't be determined from the message, keep the previous value
${useAgent ? `4. Identify which tools should be invoked to populate any state fields that require external data
5. For each tool that should be invoked, specify:
   - tool_name: the exact name of the tool
   - reason: why this tool should be invoked
   - state_field: which state field will be populated by this tool's result
   - input_params: the parameters to pass to the tool (as a JSON object)` : ''}

Respond with ONLY a valid JSON object in the following format:
{{
  "state": {{
    // Complete state object with all fields from state model
  }}${useAgent ? `,
  "tools_to_invoke": [
    // Array of tool invocation objects, or empty array if no tools needed
    {{
      "tool_name": "Tool Name",
      "reason": "Reason for invocation",
      "state_field": "field_name",
      "input_params": {{}}
    }}
  ]` : ''}
}}
`);

					const stateAnalysisChain = RunnableSequence.from([
						stateAnalysisPrompt,
						llm as any,
						new StringOutputParser(),
					]) as any;

					const stateAnalysisInput: Record<string, any> = {
						stateFields: stateFieldDescriptions,
						currentState: Object.keys(prevStateModelOnly).length > 0 ? JSON.stringify(prevStateModelOnly, null, 2) : "{}",
						userMessage: userMessage,
					};

					if (useAgent) {
						stateAnalysisInput.availableTools = availableToolsDesc;
					}

					if (conversationHistory && conversationHistoryValue) {
						stateAnalysisInput.conversation_history = StatefulAIAgent.formatConversationHistory(conversationHistoryValue);
					}

					const stateAnalysisResult = await stateAnalysisChain.invoke(stateAnalysisInput as any);

					let toolsToInvoke: any[] = [];
					try {
						const cleanedResult = StatefulAIAgent.cleanJsonResponse(stateAnalysisResult);
						const parsedResult = JSON.parse(cleanedResult);

						stateChangedProps = StatefulAIAgent.validateAndExtractState(
							parsedResult,
							stateModel,
							state,
							prevStateModelOnly,
							stateChangedProps,
							isFirstRun
						);

						if (useAgent) {
							toolsToInvoke = parsedResult.tools_to_invoke || [];

							if (!Array.isArray(toolsToInvoke)) {
								toolsToInvoke = [];
							}
						}

					} catch (error) {
						throw new Error(`Failed to parse state analysis JSON: ${error.message}`);
					}

					if (toolsToInvoke.length > 0) {
						await StatefulAIAgent.invokeTools(toolsToInvoke, agentTools, stateModel, state, stateChangedProps);
					}

					// Generate response using system_prompt with state variables
					const stateFieldsForPrompt = StatefulAIAgent.prepareStateFieldsForTemplate(stateModel, state);

					const responsePrompt = PromptTemplate.fromTemplate(`
${systemPrompt}

${conversationHistory ? `
Previous Conversation:
{conversation_history}
` : ''}

User: {user_message}

Provide a helpful and natural response.
`);

					const responseChain = RunnableSequence.from([
						responsePrompt,
						llm as any,
						new StringOutputParser(),
					]) as any;

					const responseInput: Record<string, any> = {
						user_message: userMessage,
						...stateFieldsForPrompt
					};

					if (conversationHistory && conversationHistoryValue) {
						responseInput.conversation_history = StatefulAIAgent.formatConversationHistory(conversationHistoryValue);
					}

					response = await responseChain.invoke(responseInput as any);

				} else {
					// Simple Path: No state_model (just response generation)
					const stateForTemplate: Record<string, any> = {};
					for (const [key, value] of Object.entries(state)) {
						if (key !== 'conversation_history') {
							stateForTemplate[key] = (value === null || value === undefined) ? "" : value;
						}
					}

					const inputVariables: Record<string, any> = {
						user_message: userMessage,
						...stateForTemplate
					};

					if (conversationHistory && conversationHistoryValue) {
						inputVariables.conversation_history = StatefulAIAgent.formatConversationHistory(conversationHistoryValue);
					}

					if (useAgent) {
						const agentPrompt = PromptTemplate.fromTemplate(`
${systemPrompt}

${conversationHistory ? `
Previous Conversation:
{conversation_history}
` : ''}

You have access to various tools that can help you answer questions and perform tasks.
Use the appropriate tools when needed to provide accurate and helpful responses.

User: {user_message}

Think step-by-step and use tools when they would be helpful.

{agent_scratchpad}
`);

						try {
							const agent = await createToolCallingAgent({
								llm: llm as any,
								tools: agentTools,
								prompt: agentPrompt as any,
							});

							const agentExecutorConfig: Record<string, any> = {
								agent,
								tools: agentTools,
								verbose: true,
								maxIterations: 10,
								returnIntermediateSteps: false,
							};

							const agentExecutor = new AgentExecutor(agentExecutorConfig as any);
							const result = await agentExecutor.invoke(inputVariables as any);
							response = result.output;
						} catch (error) {
							throw new Error(`Agent failed: ${error.message}`);
						}
					} else {
						const simplePrompt = PromptTemplate.fromTemplate(`
${systemPrompt}

${conversationHistory ? `
Previous Conversation:
{conversation_history}
` : ''}

User: {user_message}

Provide a helpful and natural response.
`);

						const chain = RunnableSequence.from([
							simplePrompt,
							llm as any,
							new StringOutputParser(),
						]) as any;

						response = await chain.invoke(inputVariables as any);
					}
				}

				// Update Conversation History
				if (conversationHistory && conversationHistoryValue) {
					conversationHistoryValue.push({
						role: "user",
						message: userMessage
					});

					conversationHistoryValue.push({
						role: "assistant",
						message: response
					});

					state.conversation_history = conversationHistoryValue;

					if (!stateChangedProps.includes('conversation_history')) {
						stateChangedProps.push('conversation_history');
					}
				}

				// Save State
				if (stateManagementTool && stateChangedProps.length > 0) {
					await stateManagementTool.invoke({
						operation: "set",
						content: JSON.stringify(state),
					});
				}

				// Return output
				returnData.push({
					json: {
						response: response,
						state: state,
						prevState: prevState,
						stateChangedProps: stateChangedProps,
					},
					pairedItem: itemIndex,
				});

			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: error.message },
						error,
						pairedItem: itemIndex
					});
				} else {
					if (error.context) {
						error.context.itemIndex = itemIndex;
						throw error;
					}
					throw new NodeOperationError(this.getNode(), error, {
						itemIndex,
					});
				}
			}
		}

		return [returnData];
	}
}
