'use client';

import React, { useState, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Building2, Package, FileText, DollarSign, Home, AlertCircle, RefreshCw, WifiOff } from 'lucide-react';
import { AssetType, DeploymentOptions } from '@/lib/types';
import { useToast, useErrorTranslator } from '@/components/Toast';

interface AssetDeployerProps {
  onDeploy: (options: DeploymentOptions) => Promise<{ transactionHash: string; tokenAddress: string }>;
  isLoading?: boolean;
}

const assetTypeIcons = {
  real_estate: Building2,
  commodity: Package,
  invoice: FileText,
  security: DollarSign,
  bond: DollarSign,
  art: Package,
  intellectual_property: FileText,
};

const assetTypeDescriptions = {
  real_estate: 'Tokenize commercial or residential properties with fractional ownership',
  commodity: 'Back tokens with physical commodities like gold, oil, or agricultural products',
  invoice: 'Convert accounts receivable into tradable tokens for immediate liquidity',
  security: 'Represent equity shares, bonds, or other regulated securities',
  bond: 'Tokenize debt instruments with fixed income streams',
  art: 'Fractional ownership of fine art and collectibles',
  intellectual_property: 'Tokenize patents, trademarks, and other IP assets',
};

export default function AssetDeployer({ onDeploy, isLoading = false }: AssetDeployerProps) {
  const toast = useToast();
  const translateError = useErrorTranslator();

  const [formData, setFormData] = useState({
    name: '',
    symbol: '',
    totalSupply: '',
    decimals: '18',
    assetType: '' as AssetType,
    metadata: {} as Record<string, string>,
    complianceRegistry: '',
    dividendDistributor: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [isNetworkError, setIsNetworkError] = useState(false);
  const [lastDeploymentOptions, setLastDeploymentOptions] = useState<DeploymentOptions | null>(null);

  const validateForm = useCallback(() => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Asset name is required';
    } else if (formData.name.length < 3) {
      newErrors.name = 'Asset name must be at least 3 characters';
    }

    if (!formData.symbol.trim()) {
      newErrors.symbol = 'Asset symbol is required';
    } else if (formData.symbol.length < 2 || formData.symbol.length > 8) {
      newErrors.symbol = 'Asset symbol must be 2-8 characters';
    } else if (!/^[A-Z0-9]+$/.test(formData.symbol)) {
      newErrors.symbol = 'Asset symbol must contain only uppercase letters and numbers';
    }

    if (!formData.totalSupply) {
      newErrors.totalSupply = 'Total supply is required';
    } else if (isNaN(Number(formData.totalSupply)) || Number(formData.totalSupply) <= 0) {
      newErrors.totalSupply = 'Total supply must be a positive number';
    }

    if (!formData.assetType) {
      newErrors.assetType = 'Asset type is required';
    }

    if (!formData.complianceRegistry) {
      newErrors.complianceRegistry = 'Compliance registry address is required';
    }

    if (!formData.dividendDistributor) {
      newErrors.dividendDistributor = 'Dividend distributor address is required';
    }

    const decimals = Number(formData.decimals);
    if (isNaN(decimals) || decimals < 0 || decimals > 18) {
      newErrors.decimals = 'Decimals must be between 0 and 18';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData]);

  const executeDeploy = useCallback(async () => {
    // Clear previous error state
    setDeployError(null);
    setIsNetworkError(false);

    if (!validateForm()) {
      toast.warning('Form Validation', 'Please fix the highlighted fields before submitting.');
      return;
    }

    setIsSubmitting(true);
    const deploymentOptions: DeploymentOptions = {
      name: formData.name,
      symbol: formData.symbol,
      totalSupply: formData.totalSupply,
      decimals: Number(formData.decimals),
      assetType: formData.assetType,
      metadata: formData.metadata,
      complianceRegistry: formData.complianceRegistry,
      dividendDistributor: formData.dividendDistributor,
    };

    // Store for retry
    setLastDeploymentOptions(deploymentOptions);

    try {
      const result = await onDeploy(deploymentOptions);

      toast.success(
        'Token Deployed Successfully',
        `Token ${formData.symbol} deployed at ${result.tokenAddress.slice(0, 8)}...`
      );

      // Reset form on success
      setFormData({
        name: '',
        symbol: '',
        totalSupply: '',
        decimals: '18',
        assetType: '' as AssetType,
        metadata: {},
        complianceRegistry: '',
        dividendDistributor: '',
      });
      setLastDeploymentOptions(null);
      setDeployError(null);
    } catch (error: any) {
      const { title, message } = translateError(error);

      // Detect network errors for special UI
      if (error?.code === 'NETWORK_ERROR' || error?.message?.includes('fetch') || error?.message?.includes('Network')) {
        setIsNetworkError(true);
      }

      setDeployError(message);
      toast.error(title, message, () => executeDeploy());
    } finally {
      setIsSubmitting(false);
    }
  }, [formData, validateForm, onDeploy, toast, translateError]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    executeDeploy();
  };

  const handleRetry = () => {
    executeDeploy();
  };

  const updateMetadata = (key: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      metadata: {
        ...prev.metadata,
        [key]: value,
      },
    }));
  };

  const removeMetadata = (key: string) => {
    setFormData(prev => {
      const newMetadata = { ...prev.metadata };
      delete newMetadata[key];
      return {
        ...prev,
        metadata: newMetadata,
      };
    });
  };

  const addMetadataField = () => {
    const key = prompt('Enter metadata key:');
    if (key && key.trim()) {
      updateMetadata(key.trim(), '');
    }
  };

  return (
    <div
      className="max-w-4xl mx-auto space-y-6"
      role="region"
      aria-label="Asset deployment form"
    >
      {/* Status message for screen readers */}
      {statusMessage && (
        <div
          role="status"
          aria-live="polite"
          className="sr-only"
        >
          {statusMessage}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" aria-hidden="true" />
            Deploy New RWA Token
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Network Error Banner */}
          {isNetworkError && (
            <Alert variant="destructive" className="mb-4">
              <WifiOff className="h-4 w-4" />
              <AlertDescription className="flex items-center justify-between flex-1">
                <span>Network connection error. Please check your connection to the Stellar network.</span>
                {lastDeploymentOptions && (
                  <Button variant="outline" size="sm" onClick={handleRetry} disabled={isSubmitting}>
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Retry
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Deployment Error Banner */}
          {deployError && !isNetworkError && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="flex items-center justify-between flex-1">
                <span>{deployError}</span>
                {lastDeploymentOptions && (
                  <Button variant="outline" size="sm" onClick={handleRetry} disabled={isSubmitting}>
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Retry
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Asset Name */}
              <div className="space-y-2">
                <Label htmlFor="asset-name">Asset Name</Label>
                <Input
                  id="asset-name"
                  value={formData.name}
                  onChange={(e) => {
                    setFormData(prev => ({ ...prev, name: e.target.value }));
                    if (errors.name) setErrors(prev => ({ ...prev, name: '' }));
                  }}
                  placeholder="e.g., Manhattan Office Tower"
                  aria-required="true"
                  aria-invalid={!!errors.name}
                  aria-describedby={errors.name ? errorId('name') : undefined}
                  className={errors.name ? 'border-red-500 focus:ring-red-500' : 'focus:ring-blue-500'}
                />
                {errors.name && (
                  <p id={errorId('name')} className="text-sm text-red-500" role="alert">
                    {errors.name}
                  </p>
                )}
              </div>

              {/* Asset Symbol */}
              <div className="space-y-2">
                <Label htmlFor="asset-symbol">Asset Symbol</Label>
                <Input
                  id="asset-symbol"
                  value={formData.symbol}
                  onChange={(e) => {
                    setFormData(prev => ({ ...prev, symbol: e.target.value.toUpperCase() }));
                    if (errors.symbol) setErrors(prev => ({ ...prev, symbol: '' }));
                  }}
                  placeholder="e.g., MOT"
                  aria-required="true"
                  aria-invalid={!!errors.symbol}
                  aria-describedby={errors.symbol ? errorId('symbol') : undefined}
                  className={errors.symbol ? 'border-red-500 focus:ring-red-500' : 'focus:ring-blue-500'}
                />
                {errors.symbol && (
                  <p id={errorId('symbol')} className="text-sm text-red-500" role="alert">
                    {errors.symbol}
                  </p>
                )}
              </div>

              {/* Total Supply */}
              <div className="space-y-2">
                <Label htmlFor="asset-total-supply">Total Supply</Label>
                <Input
                  id="asset-total-supply"
                  value={formData.totalSupply}
                  onChange={(e) => {
                    setFormData(prev => ({ ...prev, totalSupply: e.target.value }));
                    if (errors.totalSupply) setErrors(prev => ({ ...prev, totalSupply: '' }));
                  }}
                  placeholder="e.g., 1000000"
                  aria-required="true"
                  aria-invalid={!!errors.totalSupply}
                  aria-describedby={errors.totalSupply ? errorId('totalsupply') : undefined}
                  className={errors.totalSupply ? 'border-red-500 focus:ring-red-500' : 'focus:ring-blue-500'}
                />
                {errors.totalSupply && (
                  <p id={errorId('totalsupply')} className="text-sm text-red-500" role="alert">
                    {errors.totalSupply}
                  </p>
                )}
              </div>

              {/* Decimals */}
              <div className="space-y-2">
                <Label htmlFor="asset-decimals">Decimals</Label>
                <Select
                  value={formData.decimals}
                  onValueChange={(value) => {
                    setFormData(prev => ({ ...prev, decimals: value }));
                    if (errors.decimals) setErrors(prev => ({ ...prev, decimals: '' }));
                  }}
                >
                  <SelectTrigger
                    id="asset-decimals"
                    aria-invalid={!!errors.decimals}
                    aria-describedby={errors.decimals ? errorId('decimals') : undefined}
                    className={`focus:ring-blue-500 ${errors.decimals ? 'border-red-500' : ''}`}
                  >
                    <SelectValue placeholder="Select decimals" />
                  </SelectTrigger>
                  <SelectContent>
                    {[0, 6, 8, 12, 18].map(dec => (
                      <SelectItem key={dec} value={dec.toString()}>
                        {dec} {dec === 18 ? '(Standard)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.decimals && (
                  <p id={errorId('decimals')} className="text-sm text-red-500" role="alert">
                    {errors.decimals}
                  </p>
                )}
              </div>
            </div>

            {/* Asset Type Selection */}
            <fieldset className="space-y-4">
              <legend className="text-sm font-medium">Asset Type</legend>
              <div
                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
                role="radiogroup"
                aria-label="Select asset type"
                aria-required="true"
              >
                {Object.entries(assetTypeIcons).map(([type, Icon]) => (
                  <Card
                    key={type}
                    role="radio"
                    tabIndex={0}
                    aria-checked={formData.assetType === type}
                    aria-label={`${type.replace('_', ' ')} - ${assetTypeDescriptions[type as AssetType]}`}
                    className={`cursor-pointer transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                      formData.assetType === type
                        ? 'ring-2 ring-blue-500 bg-blue-50'
                        : 'hover:bg-gray-50'
                    }`}
                    onClick={() => {
                      setFormData(prev => ({ ...prev, assetType: type as AssetType }));
                      if (errors.assetType) setErrors(prev => ({ ...prev, assetType: '' }));
                    }}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start space-x-3">
                        <Icon className="h-6 w-6 text-gray-600 mt-1" aria-hidden="true" />
                        <div className="flex-1">
                          <h3 className="font-medium capitalize">
                            {type.replace('_', ' ')}
                          </h3>
                          <p className="text-sm text-gray-600 mt-1">
                            {assetTypeDescriptions[type as AssetType]}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              {errors.assetType && (
                <p id={errorId('assettype')} className="text-sm text-red-500" role="alert">
                  {errors.assetType}
                </p>
              )}
            </fieldset>

            {/* Contract Addresses */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="asset-compliance-registry">Compliance Registry Address</Label>
                <Input
                  id="asset-compliance-registry"
                  value={formData.complianceRegistry}
                  onChange={(e) => {
                    setFormData(prev => ({ ...prev, complianceRegistry: e.target.value }));
                    if (errors.complianceRegistry) setErrors(prev => ({ ...prev, complianceRegistry: '' }));
                  }}
                  placeholder="0x..."
                  aria-required="true"
                  aria-invalid={!!errors.complianceRegistry}
                  aria-describedby={errors.complianceRegistry ? errorId('complianceregistry') : undefined}
                  className={errors.complianceRegistry ? 'border-red-500 focus:ring-red-500' : 'focus:ring-blue-500'}
                />
                {errors.complianceRegistry && (
                  <p id={errorId('complianceregistry')} className="text-sm text-red-500" role="alert">
                    {errors.complianceRegistry}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="asset-dividend-distributor">Dividend Distributor Address</Label>
                <Input
                  id="asset-dividend-distributor"
                  value={formData.dividendDistributor}
                  onChange={(e) => {
                    setFormData(prev => ({ ...prev, dividendDistributor: e.target.value }));
                    if (errors.dividendDistributor) setErrors(prev => ({ ...prev, dividendDistributor: '' }));
                  }}
                  placeholder="0x..."
                  aria-required="true"
                  aria-invalid={!!errors.dividendDistributor}
                  aria-describedby={errors.dividendDistributor ? errorId('dividenddistributor') : undefined}
                  className={errors.dividendDistributor ? 'border-red-500 focus:ring-red-500' : 'focus:ring-blue-500'}
                />
                {errors.dividendDistributor && (
                  <p id={errorId('dividenddistributor')} className="text-sm text-red-500" role="alert">
                    {errors.dividendDistributor}
                  </p>
                )}
              </div>
            </div>

            {/* Metadata Section */}
            <fieldset className="space-y-4">
              <div className="flex items-center justify-between">
                <legend className="text-sm font-medium">Asset Metadata</legend>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addMetadataField}
                  aria-label="Add metadata field"
                >
                  Add Field
                </Button>
              </div>

              <div className="space-y-2">
                {Object.entries(formData.metadata).map(([key, value]) => (
                  <div key={key} className="flex gap-2">
                    <Input
                      value={key}
                      disabled
                      className="bg-gray-50"
                      placeholder="Key"
                      aria-label={`Metadata key: ${key}`}
                    />
                    <Input
                      value={value}
                      onChange={(e) => updateMetadata(key, e.target.value)}
                      placeholder="Value"
                      aria-label={`Metadata value for ${key}`}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => removeMetadata(key)}
                      aria-label={`Remove metadata field ${key}`}
                    >
                      Remove
                    </Button>
                  </div>
                ))}

                {Object.keys(formData.metadata).length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-4">
                    No metadata fields added. Add fields to provide additional asset information.
                  </p>
                )}
              </div>
            </fieldset>

            {/* Form Actions */}
            <div className="flex justify-end space-x-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setFormData({
                    name: '',
                    symbol: '',
                    totalSupply: '',
                    decimals: '18',
                    assetType: '' as AssetType,
                    metadata: {},
                    complianceRegistry: '',
                    dividendDistributor: '',
                  });
                  setErrors({});
                  setDeployError(null);
                  setIsNetworkError(false);
                  setLastDeploymentOptions(null);
                }}
              >
                Clear Form
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || isLoading}
                aria-label={isSubmitting || isLoading ? 'Deploying token, please wait' : 'Deploy token'}
                aria-busy={isSubmitting || isLoading}
              >
                {isSubmitting || isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    Deploying...
                  </>
                ) : (
                  'Deploy Token'
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Alert role="complementary" aria-label="Deployment information">
        <Building2 className="h-4 w-4" aria-hidden="true" />
        <AlertDescription>
          Deploying a new RWA token creates a smart contract on the Stellar blockchain.
          Make sure you have sufficient XLM for deployment fees and that all addresses are correct.
        </AlertDescription>
      </Alert>
    </div>
  );
}
