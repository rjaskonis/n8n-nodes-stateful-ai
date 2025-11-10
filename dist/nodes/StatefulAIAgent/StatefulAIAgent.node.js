"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatefulAIAgent = void 0;
const n8n_workflow_1 = require("n8n-workflow");
const runnables_1 = require("@langchain/core/runnables");
const prompts_1 = require("@langchain/core/prompts");
const output_parsers_1 = require("@langchain/core/output_parsers");
const agents_1 = require("langchain/agents");
class StatefulAIAgent {
    constructor() {
        this.description = {
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
                n8n_workflow_1.NodeConnectionTypes.Main,
                {
                    type: n8n_workflow_1.NodeConnectionTypes.AiLanguageModel,
                    displayName: 'LLM',
                    required: true,
                    maxConnections: 1,
                },
                {
                    type: n8n_workflow_1.NodeConnectionTypes.AiTool,
                    displayName: 'Tools',
                    maxConnections: undefined,
                },
            ],
            outputs: [n8n_workflow_1.NodeConnectionTypes.Main],
            properties: [
                {
                    displayName: 'State Management Workflow',
                    name: 'stateWorkflowId',
                    type: 'workflowSelector',
                    default: '',
                    required: true,
                    description: 'Select the workflow that handles state storage. The workflow must have an Execute Workflow Trigger with "operation" (supporting "get" and "set" values) and "content" input fields.',
                },
                {
                    displayName: 'This node will send "get" or "set" to the "operation" field and the state content to the "content" field when calling the State Management Workflow. By using this workflow approach, you can track and store state in any way you prefer - whether it\'s in a database, file system, cloud storage, or any other storage solution that fits your needs.',
                    name: 'stateWorkflowInfo',
                    type: 'notice',
                    default: '',
                },
                {
                    displayName: 'Session ID',
                    name: 'sessionId',
                    type: 'string',
                    default: '',
                    required: true,
                    description: 'Unique identifier for the conversation session',
                },
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
    }
    static formatConversationHistory(history) {
        if (!Array.isArray(history) || history.length === 0) {
            return "No previous conversation.";
        }
        return history.map(entry => `${entry.role}: ${entry.message}`).join("\n");
    }
    static cleanJsonResponse(jsonString) {
        let cleaned = jsonString.trim();
        if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '');
            cleaned = cleaned.replace(/\n?```\s*$/, '');
        }
        return cleaned.trim();
    }
    static prepareStateFieldsForTemplate(stateModel, state) {
        const result = {};
        for (const key of Object.keys(stateModel)) {
            const value = (key in state) ? state[key] : null;
            result[key] = (value === null || value === undefined) ? "" : value;
        }
        return result;
    }
    static parseToolResult(toolResult) {
        if (typeof toolResult !== 'string') {
            return toolResult;
        }
        try {
            return JSON.parse(toolResult);
        }
        catch (e) {
            return toolResult;
        }
    }
    static extractStateModelStructure(stateModel, prefix = '') {
        const fields = [];
        for (const [key, value] of Object.entries(stateModel)) {
            const fullPath = prefix ? `${prefix}.${key}` : key;
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                fields.push(...StatefulAIAgent.extractStateModelStructure(value, fullPath));
            }
            else {
                fields.push({
                    path: fullPath,
                    description: typeof value === 'string' ? value : JSON.stringify(value)
                });
            }
        }
        return fields;
    }
    static getNestedValue(obj, path) {
        const parts = path.split('.');
        let current = obj;
        for (const part of parts) {
            if (current === null || current === undefined || typeof current !== 'object') {
                return undefined;
            }
            current = current[part];
        }
        return current;
    }
    static setNestedValue(obj, path, value) {
        const parts = path.split('.');
        let current = obj;
        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (!(part in current) || typeof current[part] !== 'object' || current[part] === null || Array.isArray(current[part])) {
                current[part] = {};
            }
            current = current[part];
        }
        current[parts[parts.length - 1]] = value;
    }
    static mergeStateWithModel(updatedState, stateModel, currentState) {
        const mergedState = {};
        const initializeStructure = (model, target) => {
            for (const [key, value] of Object.entries(model)) {
                if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                    target[key] = {};
                    initializeStructure(value, target[key]);
                }
                else {
                    target[key] = null;
                }
            }
        };
        initializeStructure(stateModel, mergedState);
        const modelFields = StatefulAIAgent.extractStateModelStructure(stateModel);
        for (const field of modelFields) {
            const value = StatefulAIAgent.getNestedValue(updatedState, field.path);
            if (value !== undefined && value !== null) {
                StatefulAIAgent.setNestedValue(mergedState, field.path, value);
            }
            else {
                const currentValue = StatefulAIAgent.getNestedValue(currentState, field.path);
                if (currentValue !== undefined) {
                    StatefulAIAgent.setNestedValue(mergedState, field.path, currentValue);
                }
            }
        }
        return mergedState;
    }
    static async invokeTools(toolsToInvoke, agentTools, stateModel, state, stateChangedProps) {
        const invokedToolNames = [];
        const toolResults = [];
        for (const toolInvocation of toolsToInvoke) {
            const { tool_name, reason, input_params, state_field } = toolInvocation;
            const tool = agentTools.find(t => t.name === tool_name || t.name.toLowerCase() === tool_name.toLowerCase());
            if (!tool) {
                continue;
            }
            try {
                const toolResult = await tool.invoke(input_params || {});
                toolResults.push({
                    tool_name,
                    state_field,
                    result: toolResult
                });
                let targetField = state_field;
                if (!targetField && (tool_name.toLowerCase().includes('steps') || (reason === null || reason === void 0 ? void 0 : reason.toLowerCase().includes('steps')))) {
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
            }
            catch (error) {
                toolResults.push({
                    tool_name,
                    state_field,
                    error: error.message
                });
            }
        }
        return { invokedToolNames, toolResults };
    }
    static validateAndExtractState(parsedResult, stateModel, state, prevStateModelOnly, stateChangedProps, isFirstRun) {
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
    async execute() {
        const items = this.getInputData();
        const returnData = [];
        for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
            try {
                const userMessage = this.getNodeParameter('userMessage', itemIndex);
                const systemPrompt = this.getNodeParameter('systemPrompt', itemIndex, "You're a helpful assistant");
                const stateModelStr = this.getNodeParameter('stateModel', itemIndex, '');
                const conversationHistory = this.getNodeParameter('conversationHistory', itemIndex, false);
                const singlePromptStateTracking = this.getNodeParameter('singlePromptStateTracking', itemIndex, true);
                const stateWorkflowIdParam = this.getNodeParameter('stateWorkflowId', itemIndex);
                const stateWorkflowId = typeof stateWorkflowIdParam === 'object' && stateWorkflowIdParam !== null
                    ? stateWorkflowIdParam.value
                    : stateWorkflowIdParam;
                const sessionId = this.getNodeParameter('sessionId', itemIndex);
                if (!stateWorkflowId) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'State Management Workflow is required. Please select a workflow.', {
                        itemIndex,
                    });
                }
                if (!sessionId) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Session ID is required. Please provide a session identifier.', {
                        itemIndex,
                    });
                }
                let stateModel = null;
                if (stateModelStr && stateModelStr.trim()) {
                    try {
                        stateModel = JSON.parse(stateModelStr);
                    }
                    catch (error) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Invalid State Model JSON: ${error.message}`, {
                            itemIndex,
                        });
                    }
                }
                const llm = (await this.getInputConnectionData(n8n_workflow_1.NodeConnectionTypes.AiLanguageModel, 0));
                if (!llm) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'LLM is required but not connected', {
                        itemIndex,
                    });
                }
                let agentTools = [];
                try {
                    const toolsResult = await this.getInputConnectionData(n8n_workflow_1.NodeConnectionTypes.AiTool, 0);
                    if (toolsResult) {
                        if (Array.isArray(toolsResult)) {
                            agentTools = toolsResult.filter((tool) => tool && typeof tool.invoke === 'function');
                        }
                        else if (typeof toolsResult.invoke === 'function') {
                            agentTools = [toolsResult];
                        }
                    }
                }
                catch (error) {
                }
                if (!userMessage) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'User Message is required', {
                        itemIndex,
                    });
                }
                const callStateWorkflow = async (operation, content = '') => {
                    var _a, _b;
                    const inputData = {
                        sessionId,
                        operation,
                        content,
                    };
                    const result = await this.executeWorkflow({ id: stateWorkflowId }, [{
                            json: inputData
                        }]);
                    if (!((_b = (_a = result === null || result === void 0 ? void 0 : result.data) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b[0])) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'State Management workflow returned no data', {
                            itemIndex,
                        });
                    }
                    return result.data[0][0].json;
                };
                let prevState = {};
                let state = {};
                let stateChangedProps = [];
                if (stateModel || conversationHistory) {
                    const stateData = await callStateWorkflow("get");
                    prevState = stateData || {};
                }
                let conversationHistoryValue = null;
                if (conversationHistory) {
                    conversationHistoryValue = prevState.conversation_history || [];
                }
                let response = '';
                let stateFieldDescriptions = "";
                let prevStateModelOnly = {};
                let isFirstRun = false;
                if (stateModel) {
                    const prevStateHasFields = Object.keys(stateModel).some(key => key in prevState);
                    isFirstRun = !prevStateHasFields;
                    for (const key of Object.keys(stateModel)) {
                        prevStateModelOnly[key] = (key in prevState) ? prevState[key] : null;
                    }
                    const modelFields = StatefulAIAgent.extractStateModelStructure(stateModel);
                    stateFieldDescriptions = modelFields
                        .map(field => `- ${field.path}: ${field.description}`)
                        .join("\n");
                }
                const availableToolsDesc = agentTools.length > 0
                    ? agentTools.map(tool => `- ${tool.name}: ${tool.description || 'No description available'}`).join("\n")
                    : "No tools available";
                const useAgent = agentTools.length > 0;
                if (stateModel && singlePromptStateTracking) {
                    const formatExample = useAgent ? `{{
  "state": {{
    // Complete state object with all fields from state model
  }},
  "tools_to_invoke": [
    // Array of tool invocation objects, or empty array if no tools needed
    // Only request tools if you truly need external data
    {{
      "tool_name": "Tool Name",
      "reason": "Why this tool is needed",
      "state_field": "field_name",
      "input_params": {{}}
    }}
  ]
}}` : `{{
  "state": {{
    // Complete state object with all fields from state model
  }},
  "response": "Your helpful and natural response to the user"
}}`;
                    const instructionText = useAgent
                        ? 'If you need external data to populate state fields, specify which tools to invoke. DO NOT generate a response yet - that will be done after tools are executed.'
                        : 'Provide a helpful response';
                    const humanMessageContent = `State Model (fields to track):
{stateFields}

Current State:
{currentState}

${useAgent ? `Available Tools (you can request to use these if needed):
{availableTools}
` : ''}${conversationHistory ? `Previous Conversation:
{conversation_history}
` : ''}User: {user_message}

Instructions:
1. Analyze the user message and update state fields based on the state model
2. For each field in the state model, determine its value from the user message or keep the previous value
3. {instructionText}

Respond with ONLY a valid JSON object in the following format:
${formatExample}`;
                    const combinedPrompt = prompts_1.ChatPromptTemplate.fromMessages([
                        ['system', '{systemPrompt}'],
                        ['human', humanMessageContent],
                    ]);
                    const combinedChain = runnables_1.RunnableSequence.from([
                        combinedPrompt,
                        llm,
                        new output_parsers_1.StringOutputParser(),
                    ]);
                    const stateFieldsForTemplate = StatefulAIAgent.prepareStateFieldsForTemplate(stateModel, prevStateModelOnly);
                    const inputVariables = {
                        systemPrompt: systemPrompt,
                        user_message: userMessage,
                        stateFields: stateFieldDescriptions,
                        currentState: Object.keys(prevStateModelOnly).length > 0 ? JSON.stringify(prevStateModelOnly, null, 2) : "{}",
                        instructionText: instructionText,
                        ...stateFieldsForTemplate
                    };
                    if (useAgent) {
                        inputVariables.availableTools = availableToolsDesc;
                    }
                    if (conversationHistory && conversationHistoryValue) {
                        inputVariables.conversation_history = StatefulAIAgent.formatConversationHistory(conversationHistoryValue);
                    }
                    const combinedResult = await combinedChain.invoke(inputVariables);
                    let toolsToInvoke = [];
                    try {
                        const cleanedResult = StatefulAIAgent.cleanJsonResponse(combinedResult);
                        const parsedResult = JSON.parse(cleanedResult);
                        stateChangedProps = StatefulAIAgent.validateAndExtractState(parsedResult, stateModel, state, prevStateModelOnly, stateChangedProps, isFirstRun);
                        if (!useAgent) {
                            response = parsedResult.response || "";
                        }
                        if (useAgent) {
                            toolsToInvoke = parsedResult.tools_to_invoke || [];
                            if (!Array.isArray(toolsToInvoke)) {
                                toolsToInvoke = [];
                            }
                        }
                    }
                    catch (error) {
                        throw new Error(`Failed to parse combined JSON: ${error.message}`);
                    }
                    if (toolsToInvoke.length > 0) {
                        const { invokedToolNames, toolResults } = await StatefulAIAgent.invokeTools(toolsToInvoke, agentTools, stateModel, state, stateChangedProps);
                        if (invokedToolNames.length > 0) {
                            const toolResultsSummary = toolResults.map(result => `Tool: ${result.tool_name}
Target State Field: ${result.state_field || 'not specified'}
Result: ${JSON.stringify(result.result || result.error, null, 2)}`).join('\n\n');
                            const modelFields = StatefulAIAgent.extractStateModelStructure(stateModel);
                            const stateModelStructureDesc = modelFields
                                .map(field => `- ${field.path}: ${field.description}`)
                                .join('\n');
                            const stateModelStructureJson = JSON.stringify(stateModel, null, 2);
                            const postToolHumanMessageContent = `State Model Structure (EXACT structure to follow):
{stateModelStructure}

State Model Fields (all fields that must exist):
{stateFields}

Current State (after initial tool invocations):
{currentState}

Tool Invocation Results:
{toolResults}

${conversationHistory ? `Previous Conversation:
{conversation_history}
` : ''}User: {user_message}

The following tools were invoked to gather information:
{toolsInvoked}

CRITICAL INSTRUCTIONS:
1. Analyze the tool results and update the state to EXACTLY match the state model structure
2. DO NOT add any fields that are not in the state model
3. DO NOT change field names - use the EXACT field names from the state model (e.g., if state model has "email_address", use "email_address", NOT "emailAddress" or "recipientEmail")
4. Extract values from tool results and map them to the CORRECT state model fields
5. For nested structures, preserve the EXACT nesting structure from the state model
6. Provide a natural, helpful response to the user based on the updated state and tool results

Respond with ONLY a valid JSON object in the following format:
{{
  "state": {{
    // Complete state object that EXACTLY matches the state model structure
  }},
  "response": "Your natural response to the user"
}}`;
                            const postToolCombinedPrompt = prompts_1.ChatPromptTemplate.fromMessages([
                                ['system', '{systemPrompt}'],
                                ['human', postToolHumanMessageContent],
                            ]);
                            const postToolCombinedChain = runnables_1.RunnableSequence.from([
                                postToolCombinedPrompt,
                                llm,
                                new output_parsers_1.StringOutputParser(),
                            ]);
                            const toolsInvokedDesc = invokedToolNames
                                .map((name, idx) => `${idx + 1}. ${name}`)
                                .join('\n');
                            const stateModelFields = StatefulAIAgent.prepareStateFieldsForTemplate(stateModel, state);
                            const postToolCombinedInput = {
                                systemPrompt: systemPrompt,
                                user_message: userMessage,
                                stateModelStructure: stateModelStructureJson,
                                stateFields: stateModelStructureDesc,
                                currentState: JSON.stringify(state, null, 2),
                                toolResults: toolResultsSummary,
                                toolsInvoked: toolsInvokedDesc,
                                ...stateModelFields
                            };
                            if (conversationHistory && conversationHistoryValue) {
                                postToolCombinedInput.conversation_history = StatefulAIAgent.formatConversationHistory(conversationHistoryValue);
                            }
                            const postToolCombinedResult = await postToolCombinedChain.invoke(postToolCombinedInput);
                            try {
                                const cleanedResult = StatefulAIAgent.cleanJsonResponse(postToolCombinedResult);
                                const parsedResult = JSON.parse(cleanedResult);
                                if (parsedResult.state) {
                                    const mergedState = StatefulAIAgent.mergeStateWithModel(parsedResult.state, stateModel, state);
                                    for (const key of Object.keys(stateModel)) {
                                        const prevValue = state[key];
                                        const newValue = mergedState[key];
                                        if (JSON.stringify(prevValue) !== JSON.stringify(newValue)) {
                                            state[key] = newValue;
                                            if (!stateChangedProps.includes(key)) {
                                                stateChangedProps.push(key);
                                            }
                                        }
                                    }
                                }
                                if (parsedResult.response) {
                                    response = parsedResult.response;
                                }
                            }
                            catch (error) {
                            }
                        }
                    }
                    else if (useAgent && toolsToInvoke.length === 0) {
                        const stateFieldsForPrompt = StatefulAIAgent.prepareStateFieldsForTemplate(stateModel, state);
                        const responseHumanMessageContent = `${conversationHistory ? `Previous Conversation:
{conversation_history}
` : ''}User: {user_message}

Provide a helpful and natural response.`;
                        const responsePrompt = prompts_1.ChatPromptTemplate.fromMessages([
                            ['system', '{systemPrompt}'],
                            ['human', responseHumanMessageContent],
                        ]);
                        const responseChain = runnables_1.RunnableSequence.from([
                            responsePrompt,
                            llm,
                            new output_parsers_1.StringOutputParser(),
                        ]);
                        const responseInput = {
                            systemPrompt: systemPrompt,
                            user_message: userMessage,
                            ...stateFieldsForPrompt
                        };
                        if (conversationHistory && conversationHistoryValue) {
                            responseInput.conversation_history = StatefulAIAgent.formatConversationHistory(conversationHistoryValue);
                        }
                        response = await responseChain.invoke(responseInput);
                    }
                }
                else if (stateModel && !singlePromptStateTracking) {
                    const stateAnalysisFormatExample = useAgent ? `{{
  "state": {{
    // Complete state object with all fields from state model
  }},
  "tools_to_invoke": [
    // Array of tool invocation objects, or empty array if no tools needed
    {{
      "tool_name": "Tool Name",
      "reason": "Reason for invocation",
      "state_field": "field_name",
      "input_params": {{}}
    }}
  ]
}}` : `{{
  "state": {{
    // Complete state object with all fields from state model
  }}
}}`;
                    const stateAnalysisSystemMessage = `You are analyzing a user message to update the conversation state and determine which tools should be invoked.

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
${stateAnalysisFormatExample}`;
                    const stateAnalysisHumanMessage = `State Model (fields to track):
{stateFields}

Current State:
{currentState}

${useAgent ? `Available Tools (name and description):
{availableTools}
` : ''}${conversationHistory ? `Previous Conversation:
{conversation_history}
` : ''}User Message: {userMessage}`;
                    const stateAnalysisPrompt = prompts_1.ChatPromptTemplate.fromMessages([
                        ['system', stateAnalysisSystemMessage],
                        ['human', stateAnalysisHumanMessage],
                    ]);
                    const stateAnalysisChain = runnables_1.RunnableSequence.from([
                        stateAnalysisPrompt,
                        llm,
                        new output_parsers_1.StringOutputParser(),
                    ]);
                    const stateAnalysisInput = {
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
                    const stateAnalysisResult = await stateAnalysisChain.invoke(stateAnalysisInput);
                    let toolsToInvoke = [];
                    try {
                        const cleanedResult = StatefulAIAgent.cleanJsonResponse(stateAnalysisResult);
                        const parsedResult = JSON.parse(cleanedResult);
                        stateChangedProps = StatefulAIAgent.validateAndExtractState(parsedResult, stateModel, state, prevStateModelOnly, stateChangedProps, isFirstRun);
                        if (useAgent) {
                            toolsToInvoke = parsedResult.tools_to_invoke || [];
                            if (!Array.isArray(toolsToInvoke)) {
                                toolsToInvoke = [];
                            }
                        }
                    }
                    catch (error) {
                        throw new Error(`Failed to parse state analysis JSON: ${error.message}`);
                    }
                    if (toolsToInvoke.length > 0) {
                        const { invokedToolNames, toolResults } = await StatefulAIAgent.invokeTools(toolsToInvoke, agentTools, stateModel, state, stateChangedProps);
                        if (invokedToolNames.length > 0) {
                            const toolResultsSummary = toolResults.map(result => `Tool: ${result.tool_name}
Target State Field: ${result.state_field || 'not specified'}
Result: ${JSON.stringify(result.result || result.error, null, 2)}`).join('\n\n');
                            const modelFields = StatefulAIAgent.extractStateModelStructure(stateModel);
                            const stateModelStructureDesc = modelFields
                                .map(field => `- ${field.path}: ${field.description}`)
                                .join('\n');
                            const stateModelStructureJson = JSON.stringify(stateModel, null, 2);
                            const postToolStateFormatExample = stateModelStructureJson.replace(/\{/g, '{{').replace(/\}/g, '}}');
                            const postToolStateSystemMessage = `You are analyzing tool results to properly update the state based on the EXACT state model structure.

CRITICAL INSTRUCTIONS:
1. You MUST return a state object that EXACTLY matches the state model structure shown above
2. DO NOT add any fields that are not in the state model
3. DO NOT change field names - use the EXACT field names from the state model (e.g., if state model has "email_address", use "email_address", NOT "emailAddress" or "recipientEmail")
4. Extract values from tool results and map them to the CORRECT state model fields
5. For nested structures, preserve the EXACT nesting structure from the state model
6. If a tool result has a field like "emailAddress", map it to "email_address" if that's what the state model expects
7. Only include fields that exist in the state model structure

Respond with ONLY a valid JSON object that EXACTLY matches the state model structure shown in the human message.`;
                            const postToolStateHumanMessage = `State Model Structure (EXACT structure to follow):
{stateModelStructure}

State Model Fields (all fields that must exist):
{stateFields}

Current State (after initial tool invocations):
{currentState}

Tool Invocation Results:
{toolResults}

User Message (for context): {userMessage}

Format Example (EXACT structure to match):
${postToolStateFormatExample}`;
                            const postToolStatePrompt = prompts_1.ChatPromptTemplate.fromMessages([
                                ['system', postToolStateSystemMessage],
                                ['human', postToolStateHumanMessage],
                            ]);
                            const postToolStateChain = runnables_1.RunnableSequence.from([
                                postToolStatePrompt,
                                llm,
                                new output_parsers_1.StringOutputParser(),
                            ]);
                            const postToolStateResult = await postToolStateChain.invoke({
                                stateModelStructure: stateModelStructureJson,
                                stateFields: stateModelStructureDesc,
                                currentState: JSON.stringify(state, null, 2),
                                toolResults: toolResultsSummary,
                                userMessage: userMessage,
                            });
                            try {
                                const cleanedResult = StatefulAIAgent.cleanJsonResponse(postToolStateResult);
                                const updatedState = JSON.parse(cleanedResult);
                                const mergedState = StatefulAIAgent.mergeStateWithModel(updatedState, stateModel, state);
                                for (const key of Object.keys(stateModel)) {
                                    const prevValue = state[key];
                                    const newValue = mergedState[key];
                                    if (JSON.stringify(prevValue) !== JSON.stringify(newValue)) {
                                        state[key] = newValue;
                                        if (!stateChangedProps.includes(key)) {
                                            stateChangedProps.push(key);
                                        }
                                    }
                                }
                            }
                            catch (error) {
                            }
                            const stateFieldsForPrompt = StatefulAIAgent.prepareStateFieldsForTemplate(stateModel, state);
                            const responseHumanMessageContent = `${conversationHistory ? `Previous Conversation:
{conversation_history}
` : ''}User: {user_message}

Provide a helpful and natural response.`;
                            const responsePrompt = prompts_1.ChatPromptTemplate.fromMessages([
                                ['system', '{systemPrompt}'],
                                ['human', responseHumanMessageContent],
                            ]);
                            const responseChain = runnables_1.RunnableSequence.from([
                                responsePrompt,
                                llm,
                                new output_parsers_1.StringOutputParser(),
                            ]);
                            const responseInput = {
                                systemPrompt: systemPrompt,
                                user_message: userMessage,
                                ...stateFieldsForPrompt
                            };
                            if (conversationHistory && conversationHistoryValue) {
                                responseInput.conversation_history = StatefulAIAgent.formatConversationHistory(conversationHistoryValue);
                            }
                            response = await responseChain.invoke(responseInput);
                        }
                        else {
                            const stateFieldsForPrompt = StatefulAIAgent.prepareStateFieldsForTemplate(stateModel, state);
                            const responseHumanMessageContent = `${conversationHistory ? `Previous Conversation:
{conversation_history}
` : ''}User: {user_message}

Provide a helpful and natural response.`;
                            const responsePrompt = prompts_1.ChatPromptTemplate.fromMessages([
                                ['system', '{systemPrompt}'],
                                ['human', responseHumanMessageContent],
                            ]);
                            const responseChain = runnables_1.RunnableSequence.from([
                                responsePrompt,
                                llm,
                                new output_parsers_1.StringOutputParser(),
                            ]);
                            const responseInput = {
                                systemPrompt: systemPrompt,
                                user_message: userMessage,
                                ...stateFieldsForPrompt
                            };
                            if (conversationHistory && conversationHistoryValue) {
                                responseInput.conversation_history = StatefulAIAgent.formatConversationHistory(conversationHistoryValue);
                            }
                            response = await responseChain.invoke(responseInput);
                        }
                    }
                    else {
                        const stateFieldsForPrompt = StatefulAIAgent.prepareStateFieldsForTemplate(stateModel, state);
                        const responseHumanMessageContent = `${conversationHistory ? `Previous Conversation:
{conversation_history}
` : ''}User: {user_message}

Provide a helpful and natural response.`;
                        const responsePrompt = prompts_1.ChatPromptTemplate.fromMessages([
                            ['system', '{systemPrompt}'],
                            ['human', responseHumanMessageContent],
                        ]);
                        const responseChain = runnables_1.RunnableSequence.from([
                            responsePrompt,
                            llm,
                            new output_parsers_1.StringOutputParser(),
                        ]);
                        const responseInput = {
                            systemPrompt: systemPrompt,
                            user_message: userMessage,
                            ...stateFieldsForPrompt
                        };
                        if (conversationHistory && conversationHistoryValue) {
                            responseInput.conversation_history = StatefulAIAgent.formatConversationHistory(conversationHistoryValue);
                        }
                        response = await responseChain.invoke(responseInput);
                    }
                }
                else {
                    const stateForTemplate = {};
                    for (const [key, value] of Object.entries(state)) {
                        if (key !== 'conversation_history') {
                            stateForTemplate[key] = (value === null || value === undefined) ? "" : value;
                        }
                    }
                    const inputVariables = {
                        user_message: userMessage,
                        ...stateForTemplate
                    };
                    if (conversationHistory && conversationHistoryValue) {
                        inputVariables.conversation_history = StatefulAIAgent.formatConversationHistory(conversationHistoryValue);
                    }
                    inputVariables.systemPrompt = systemPrompt;
                    if (useAgent) {
                        const agentHumanMessageContent = `${conversationHistory ? `Previous Conversation:
{conversation_history}
` : ''}You have access to various tools that can help you answer questions and perform tasks.
Use the appropriate tools when needed to provide accurate and helpful responses.

User: {user_message}

Think step-by-step and use tools when they would be helpful.

{agent_scratchpad}`;
                        const agentPrompt = prompts_1.ChatPromptTemplate.fromMessages([
                            ['system', '{systemPrompt}'],
                            ['human', agentHumanMessageContent],
                        ]);
                        try {
                            const agent = await (0, agents_1.createToolCallingAgent)({
                                llm: llm,
                                tools: agentTools,
                                prompt: agentPrompt,
                            });
                            const agentExecutorConfig = {
                                agent,
                                tools: agentTools,
                                verbose: true,
                                maxIterations: 10,
                                returnIntermediateSteps: false,
                            };
                            const agentExecutor = new agents_1.AgentExecutor(agentExecutorConfig);
                            const result = await agentExecutor.invoke(inputVariables);
                            response = result.output;
                        }
                        catch (error) {
                            throw new Error(`Agent failed: ${error.message}`);
                        }
                    }
                    else {
                        const simpleHumanMessageContent = `${conversationHistory ? `Previous Conversation:
{conversation_history}
` : ''}User: {user_message}

Provide a helpful and natural response.`;
                        const simplePrompt = prompts_1.ChatPromptTemplate.fromMessages([
                            ['system', '{systemPrompt}'],
                            ['human', simpleHumanMessageContent],
                        ]);
                        const chain = runnables_1.RunnableSequence.from([
                            simplePrompt,
                            llm,
                            new output_parsers_1.StringOutputParser(),
                        ]);
                        inputVariables.systemPrompt = systemPrompt;
                        response = await chain.invoke(inputVariables);
                    }
                }
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
                if ((stateModel || conversationHistory) && stateChangedProps.length > 0) {
                    await callStateWorkflow("set", JSON.stringify(state));
                }
                returnData.push({
                    json: {
                        response: response,
                        state: state,
                        prevState: prevState,
                        stateChangedProps: stateChangedProps,
                    },
                    pairedItem: itemIndex,
                });
            }
            catch (error) {
                if (this.continueOnFail()) {
                    returnData.push({
                        json: { error: error.message },
                        error,
                        pairedItem: itemIndex
                    });
                }
                else {
                    if (error.context) {
                        error.context.itemIndex = itemIndex;
                        throw error;
                    }
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), error, {
                        itemIndex,
                    });
                }
            }
        }
        return [returnData];
    }
}
exports.StatefulAIAgent = StatefulAIAgent;
//# sourceMappingURL=StatefulAIAgent.node.js.map