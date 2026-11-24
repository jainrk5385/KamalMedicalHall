import { useState } from 'react';
import { Image, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { uploadPrescription } from '../../api/upload';
import type { PrescriptionFile } from '../../store/cart';
import { endpoints } from '../../api/endpoints';
import type { Product } from '../../api/types';
import { useLoad, useErrorPopup } from '../../hooks';
import { Button, ButtonRow, Card, Message, Screen, TextField } from '../../components/ui';
import { tick } from '../../components/motion';
import { showDialog } from '../../dialog';
import { colors, spacing, type } from '../../theme';

const blank = { name:'', description:'', images:'', price:'', discountedPrice:'', stockQuantity:'0', isAvailable:true };
export function ProductCatalogScreen() {
  const {data,reload,loading,error}=useLoad(()=>endpoints.admin.products());
  const [form,setForm]=useState(blank);
  const [editing,setEditing]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [uploading,setUploading]=useState(false);
  const [err,setErr]=useState(''); useErrorPopup(err);
  const save=async()=>{
    const price=Number(form.price), stockQuantity=Number(form.stockQuantity), discountedPrice=form.discountedPrice.trim()?Number(form.discountedPrice):null;
    if(!form.name.trim()||!Number.isFinite(price)||price<0||!Number.isInteger(stockQuantity)||stockQuantity<0||(discountedPrice!==null&&(!Number.isFinite(discountedPrice)||discountedPrice<0||discountedPrice>price))){setErr('Please check product name, price, discount and stock quantity.');return;}
    const payload={name:form.name.trim(),description:form.description.trim(),images:form.images.split(/\n|,/).map(x=>x.trim()).filter(Boolean),price,discountedPrice,stockQuantity,isAvailable:form.isAvailable};
    setBusy(true);setErr('');
    try{if(editing)await endpoints.admin.updateProduct(editing,payload);else await endpoints.admin.createProduct(payload);setForm(blank);setEditing(null);tick('success');await reload();}catch(e){setErr((e as Error).message);}finally{setBusy(false);}
  };
  const addImages=async()=>{
    setErr('');
    try {
      const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'],allowsMultipleSelection:true,selectionLimit:8,quality:0.85});
      if(result.canceled||!result.assets?.length)return;
      setUploading(true);
      const existing=form.images.split(/\n|,/).map(x=>x.trim()).filter(Boolean);
      for(const asset of result.assets){
        if(existing.length>=8)break;
        const file:PrescriptionFile={id:`${Date.now()}-${existing.length}`,uri:asset.uri,name:asset.fileName??'product.jpg',mimeType:asset.mimeType?.startsWith('image/')?asset.mimeType:'image/jpeg',sizeBytes:asset.fileSize};
        const sig=await endpoints.signUpload('product');
        const uploaded=await uploadPrescription(file,sig);
        existing.push(uploaded.publicId);
      }
      setForm({...form,images:existing.join('\n')});
      tick('success');
    } catch(e){setErr((e as Error).message);} finally {setUploading(false);}
  };
  const edit=(p:Product)=>{setEditing(p.id);setForm({name:p.name,description:p.description,images:(p.imagePublicIds ?? []).join('\n'),price:String(p.price),discountedPrice:p.discountedPrice==null?'':String(p.discountedPrice),stockQuantity:String(p.stockQuantity),isAvailable:p.isAvailable});};
  const remove=async(p:Product)=>{const ok=await showDialog({title:'Delete product?',message:`Delete “${p.name}”? This cannot be undone.`,icon:'trash',tone:'danger',confirmLabel:'Delete',cancelLabel:'Cancel'});if(!ok)return;try{await endpoints.admin.deleteProduct(p.id);await reload();tick('success');}catch(e){setErr((e as Error).message);}};
  return <Screen>
    <Text style={[type.h2,{color:colors.text}]}>Product catalogue</Text>
    <Text style={[type.small,{color:colors.secondary}]}>Manage customer-facing products. Upload up to 8 product photos. Products are informational only; no cart or checkout.</Text>
    <Card style={{gap:10}}>
      <Text style={[type.h3,{color:colors.text}]}>{editing?'Edit product':'Add product'}</Text>
      <TextField label="Product name *" value={form.name} onChangeText={v=>setForm({...form,name:v})}/>
      <TextField label="Description" value={form.description} onChangeText={v=>setForm({...form,description:v})} multiline/>
      <Text style={[type.small,{color:colors.secondary}]}>Product photos ({form.images.split(/\\n|,/).filter(Boolean).length}/8)</Text>\n      <Button title={uploading?"Uploading images…":"Choose product photos"} icon="images" variant="outline" loading={uploading} onPress={()=>{void addImages();}} disabled={uploading}/>
      <TextField label="Price (₹) *" value={form.price} onChangeText={v=>setForm({...form,price:v})} keyboardType="decimal-pad"/>
      <TextField label="Discounted price (₹)" value={form.discountedPrice} onChangeText={v=>setForm({...form,discountedPrice:v})} keyboardType="decimal-pad"/>
      <TextField label="Stock quantity *" value={form.stockQuantity} onChangeText={v=>setForm({...form,stockQuantity:v})} keyboardType="number-pad"/>
      <ButtonRow><Button title={form.isAvailable?'Available':'Unavailable'} variant="outline" onPress={()=>setForm({...form,isAvailable:!form.isAvailable})}/><Button title={busy?'Saving…':editing?'Update product':'Save product'} loading={busy} onPress={()=>{void save();}}/></ButtonRow>
      {editing?<Button title="Cancel editing" variant="ghost" onPress={()=>{setEditing(null);setForm(blank);}}/>:null}
    </Card>
    <Text style={[type.h3,{color:colors.text,marginTop:spacing.lg}]}>All products ({data?.products.length??0})</Text>
    {loading&&!data?<Text>Loading…</Text>:error&&!data?<Text>{error}</Text>:!data?.products.length?<Message icon="cube-outline" title="No products added yet"/>:data.products.map(p=><Card key={p.id} style={{gap:8}}>
      <View style={{flexDirection:'row',gap:10,alignItems:'center'}}>{p.images[0]?<Image source={{uri:p.images[0]}} style={{width:64,height:64,borderRadius:10}}/>:null}<View style={{flex:1}}><Text style={[type.bodyMedium,{color:colors.text}]}>{p.name}</Text><Text style={[type.small,{color:colors.secondary}]}>₹{p.discountedPrice??p.price} · Stock {p.stockQuantity} · {p.isAvailable?'Available':'Unavailable'}</Text></View></View>
      <ButtonRow><Button small variant="outline" title="Edit" onPress={()=>edit(p)}/><Button small variant="danger" title="Delete" onPress={()=>{void remove(p);}}/></ButtonRow>
    </Card>)}
  </Screen>;
}
